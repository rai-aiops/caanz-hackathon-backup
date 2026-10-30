import path from "path";

export type JudgeProvider = "litellm" | "openai";
export type JudgeBackendProvider = JudgeProvider | "unavailable";
export type JudgeApiKeySource = "dashboard" | "default";

export type JudgeRequestMetadata = {
  judge_provider: JudgeProvider;
  judge_model_requested: string;
  judge_model_used: string;
  judge_fallback_used: boolean;
  judge_api_key_source?: JudgeApiKeySource;
};

export type JudgeModelOptions = {
  models: string[];
  provider: JudgeBackendProvider;
  using_fallback: boolean;
  judge_api_key_source?: JudgeApiKeySource;
  error?: string;
};

type LiteLLMModel = {
  id: string;
};

const cwd = process.cwd();
const dashboardRoot = path.basename(cwd) === "dashboard" ? cwd : path.join(cwd, "dashboard");
const repoRoot = path.basename(cwd) === "dashboard" ? path.dirname(cwd) : cwd;

const ENV_FILE_PATHS = [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.agents"),
  path.join(dashboardRoot, ".env.local"),
  path.join(dashboardRoot, ".env"),
];

loadEnvFiles(ENV_FILE_PATHS);

const EXCLUDED_MODEL_PARTS = [
  "audio",
  "codex",
  "image",
  "realtime",
  "search",
  "tts",
  "transcribe",
  "whisper",
];

const FALLBACK_JUDGE_MODELS = [
  "openai/gpt-6-luna",
  "openai/gpt-6.1-sol",
  "openai/gpt-6.1-terra",
  "openai/gpt-6-sol",
  "openai/gpt-5.6",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
  "openai/gpt-5.4",
  "openai/gpt-5.4-pro",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
];

const ALLOWED_OPENAI_JUDGE_MODEL_PREFIXES = ["gpt-6.1", "gpt-6", "gpt-5.6", "gpt-5.5", "gpt-5.4"];

function loadEnvFiles(paths: string[]) {
  for (const envPath of paths) {
    try {
      process.loadEnvFile(envPath);
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
}

async function getEnvValue(key: string) {
  return process.env[key] || "";
}

async function getOpenAIApiCredentials() {
  if (process.env.DASHBOARD_OPENAI_API_KEY) {
    return {
      apiKey: process.env.DASHBOARD_OPENAI_API_KEY,
      source: "dashboard",
    } as const;
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      source: "default",
    } as const;
  }
  return null;
}

function getProviderAndModel(modelId: string) {
  const normalized = modelId.toLowerCase();
  const separatorIndex = normalized.indexOf("/");
  if (separatorIndex === -1) {
    return { provider: "openai", model: normalized };
  }
  return {
    provider: normalized.slice(0, separatorIndex),
    model: normalized.slice(separatorIndex + 1),
  };
}

function matchesAllowedJudgeModel(model: string, allowedPrefixes: string[]) {
  return (
    allowedPrefixes.some((prefix) => model === prefix || model.startsWith(`${prefix}-`))
    && !EXCLUDED_MODEL_PARTS.some((part) => model.includes(part))
  );
}

function isAllowedJudgeModel(modelId: string) {
  const { provider, model } = getProviderAndModel(modelId);
  return provider === "openai"
    && model !== "gpt-6-astra"
    && !model.startsWith("gpt-6-astra-")
    && matchesAllowedJudgeModel(model, ALLOWED_OPENAI_JUDGE_MODEL_PREFIXES);
}

function sortModels(left: string, right: string) {
  const preferred = [
    "gpt-6-luna",
    "gpt-6.1-sol",
    "gpt-6.1-terra",
    "gpt-6-sol",
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5.4",
  ];
  const leftParts = getProviderAndModel(left);
  const rightParts = getProviderAndModel(right);
  const leftPreference = preferred.findIndex((prefix) => leftParts.model.startsWith(prefix));
  const rightPreference = preferred.findIndex((prefix) => rightParts.model.startsWith(prefix));

  if (leftPreference !== rightPreference) {
    return (leftPreference === -1 ? 999 : leftPreference) - (rightPreference === -1 ? 999 : rightPreference);
  }
  return left.localeCompare(right);
}

function getFallbackJudgeModels() {
  return FALLBACK_JUDGE_MODELS
    .filter(isAllowedJudgeModel)
    .sort(sortModels);
}

async function getLiteLLMProxyBaseUrl() {
  return ((await getEnvValue("LITELLM_PROXY_BASE_URL")) || "http://localhost:4000").replace(/\/+$/, "");
}

async function getLiteLLMProxyApiKey() {
  const openAICredentials = await getOpenAIApiCredentials();
  return (await getEnvValue("LITELLM_PROXY_API_KEY")) || openAICredentials?.apiKey || "sk-litellm-local";
}

function getFetchErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getOpenAIModel(modelId: string) {
  const { provider, model } = getProviderAndModel(modelId);
  return provider === "openai" ? model : null;
}

async function openAIResponseRequest(body: Record<string, unknown>, judgeModel: string, fallback: boolean) {
  const credentials = await getOpenAIApiCredentials();
  if (!credentials) {
    throw new Error(
      "OpenAI fallback is unavailable because DASHBOARD_OPENAI_API_KEY or OPENAI_API_KEY is not configured.",
    );
  }

  const model = getOpenAIModel(judgeModel);
  if (!model) {
    throw new Error(`OpenAI fallback cannot run ${judgeModel}. Choose an OpenAI judge model.`);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, model }),
  });

  return {
    response,
    metadata: {
      judge_provider: "openai",
      judge_model_requested: judgeModel,
      judge_model_used: model,
      judge_fallback_used: fallback,
      judge_api_key_source: credentials.source,
    } satisfies JudgeRequestMetadata,
  };
}

export async function postJudgeResponses(body: Record<string, unknown>, judgeModel: string) {
  const proxyBaseUrl = await getLiteLLMProxyBaseUrl();
  const apiKey = await getLiteLLMProxyApiKey();

  try {
    const response = await fetch(`${proxyBaseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, model: judgeModel }),
    });

    return {
      response,
      metadata: {
        judge_provider: "litellm",
        judge_model_requested: judgeModel,
        judge_model_used: judgeModel,
        judge_fallback_used: false,
      } satisfies JudgeRequestMetadata,
    };
  } catch (error) {
    const liteLLMError = getFetchErrorMessage(error);
    try {
      return await openAIResponseRequest(body, judgeModel, true);
    } catch (fallbackError) {
      throw new Error(
        `LiteLLM judge request failed: ${liteLLMError}. ${getFetchErrorMessage(fallbackError)}`,
      );
    }
  }
}

export async function getJudgeModelOptions(): Promise<JudgeModelOptions> {
  const proxyBaseUrl = await getLiteLLMProxyBaseUrl();
  const apiKey = await getLiteLLMProxyApiKey();

  try {
    const response = await fetch(`${proxyBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        models: [],
        provider: "unavailable",
        using_fallback: false,
        error: `LiteLLM models request failed: ${response.status}`,
      };
    }

    const payload = (await response.json().catch(() => null)) as { data?: LiteLLMModel[] } | null;
    const models = (payload?.data ?? [])
      .map((model) => model.id)
      .filter(isAllowedJudgeModel)
      .sort(sortModels);

    if (!models.length) {
      return {
        models: [],
        provider: "unavailable",
        using_fallback: false,
        error: "LiteLLM returned no supported judge models.",
      };
    }

    return { models, provider: "litellm", using_fallback: false };
  } catch (error) {
    const credentials = await getOpenAIApiCredentials();
    if (credentials) {
      return {
        models: getFallbackJudgeModels(),
        provider: "openai",
        using_fallback: true,
        judge_api_key_source: credentials.source,
        error: `LiteLLM models request failed: ${getFetchErrorMessage(error)}. Using OpenAI fallback.`,
      };
    }

    return {
      models: [],
      provider: "unavailable",
      using_fallback: false,
      error: `LiteLLM models request failed: ${getFetchErrorMessage(error)}. DASHBOARD_OPENAI_API_KEY or OPENAI_API_KEY is not configured.`,
    };
  }
}
