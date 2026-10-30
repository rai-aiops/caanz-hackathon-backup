import { promises as fs } from "fs";
import path from "path";

const cwd = process.cwd();
const dashboardRoot = path.basename(cwd) === "dashboard" ? cwd : path.join(cwd, "dashboard");
const repoRoot = path.basename(cwd) === "dashboard" ? path.dirname(cwd) : cwd;
const promptDir = path.join(dashboardRoot, "prompts");
const savedPromptPath = path.join(promptDir, "judge-prompt.md");
const defaultPromptPath = path.join(promptDir, "default-judge-prompt.md");

export type JudgePromptConfig = {
  prompt: string;
  default_prompt: string;
  prompt_path: string;
  default_prompt_path: string;
  customized: boolean;
};

function relativeToRepo(filePath: string) {
  return path.relative(repoRoot, filePath);
}

function normalizePromptForWrite(prompt: string) {
  return `${prompt.replace(/\r\n/g, "\n").trimEnd()}\n`;
}

async function readTextFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function readDefaultJudgePrompt() {
  const prompt = await readTextFile(defaultPromptPath);
  if (!prompt?.trim()) throw new Error(`${relativeToRepo(defaultPromptPath)} is missing or empty.`);
  return prompt.trimEnd();
}

export async function readSavedJudgePrompt() {
  const defaultPrompt = await readDefaultJudgePrompt();
  const savedPrompt = await readTextFile(savedPromptPath);
  return savedPrompt?.trim() ? savedPrompt.trimEnd() : defaultPrompt;
}

export async function readJudgePromptConfig(): Promise<JudgePromptConfig> {
  const defaultPrompt = await readDefaultJudgePrompt();
  const prompt = await readSavedJudgePrompt();

  return {
    prompt,
    default_prompt: defaultPrompt,
    prompt_path: relativeToRepo(savedPromptPath),
    default_prompt_path: relativeToRepo(defaultPromptPath),
    customized: prompt !== defaultPrompt,
  };
}

export async function saveJudgePrompt(prompt: string) {
  if (!prompt.trim()) throw new Error("Judge prompt cannot be empty.");

  await fs.mkdir(promptDir, { recursive: true });
  await fs.writeFile(savedPromptPath, normalizePromptForWrite(prompt), "utf-8");
  return readJudgePromptConfig();
}
