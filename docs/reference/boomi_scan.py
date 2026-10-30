import os, sys, glob, zipfile, tempfile, re, json, urllib.request, urllib.error
from datetime import datetime, timezone

def find_latest():
    downloads = os.path.expanduser("~/Downloads")
    zips = glob.glob(os.path.join(downloads, "process_*.zip")) + \
           glob.glob(os.path.join(downloads, "ProcessLog_*.zip"))
    logs = [f for f in glob.glob(os.path.join(downloads, "ProcessLog_*.log")) if "_masked" not in f]
    all_files = zips + logs
    if not all_files:
        return None
    latest = max(all_files, key=os.path.getmtime)
    if latest.endswith(".zip"):
        extract_dir = tempfile.mkdtemp()
        with zipfile.ZipFile(latest, 'r') as z:
            log_files = [f for f in z.namelist() if f.endswith(".log")]
            if not log_files:
                return None
            z.extract(log_files[0], extract_dir)
            return os.path.join(extract_dir, log_files[0])
    return latest


# ── Prototype mode ────────────────────────────────────────────
def boomi_fetch_mock(process_name, dependency_map_path="dependency_map_synthetic.json"):
    """
    PROTOTYPE_MODE=true: reads mockBoomiResponse from dependency_map_synthetic.json
    instead of calling the live Boomi Platform API.
    Returns a temp log file path (mimicking the real boomi_fetch return value),
    or prints the mock response summary and exits.
    """
    print(f"\n  [PROTOTYPE MODE] Reading mock response for: {process_name}")

    if not os.path.exists(dependency_map_path):
        print(f"\n  Error: dependency map not found at {dependency_map_path}")
        print(f"  Place dependency_map_synthetic.json in the same directory as this script,")
        print(f"  or set DEPENDENCY_MAP_PATH env var to its full path.")
        sys.exit(1)

    with open(dependency_map_path, "r") as f:
        dep_map = json.load(f)

    entries = dep_map.get("page", {}).get("dependencyMap", {}).get("entries", [])
    matched = None
    for entry in entries:
        bp = entry.get("boomiProcess")
        if bp and bp.get("name", "").lower() == process_name.lower():
            matched = entry
            break

    if not matched:
        print(f"\n  No mock entry found for process '{process_name}' in dependency map.")
        print(f"  Available process names:")
        for e in entries:
            bp = e.get("boomiProcess")
            if bp:
                print(f"    - {bp.get('name')}")
        sys.exit(1)

    mock = matched.get("mockBoomiResponse")
    if not mock:
        print(f"\n  Entry found but mockBoomiResponse is null for '{process_name}'.")
        print(f"  Note: {matched.get('notes', '')}")
        sys.exit(0)

    status = mock.get("status", "UNKNOWN")
    exec_id = mock.get("executionId", "mock-exec-id")
    scenario = mock.get("scenario", "")

    print(f"  Scenario     : {scenario}")
    print(f"  Execution ID : {exec_id}")
    print(f"  Status       : {status}")
    print(f"  Started      : {mock.get('startTime', 'N/A')}")
    print(f"  Ended        : {mock.get('endTime', 'N/A')}")

    if status == "NO_RESULTS":
        print(f"\n  {mock.get('message', 'No results.')}\n")
        sys.exit(0)

    if status == "SUCCESS":
        print(f"\n  Process completed successfully — no errors to report.\n")
        sys.exit(0)

    # Build a synthetic log file from the mock response so scan() can parse it
    error_msg  = mock.get("errorMessage", "Unknown error")
    error_step = mock.get("errorStep", "Unknown shape")
    start_time = mock.get("startTime", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    end_time   = mock.get("endTime", start_time)

    lines = []
    lines.append(f"{start_time}\tINFO\tProcess\t\tExecuting Process {process_name}")
    lines.append(f"{start_time}\tINFO\tProcess\t{error_step}\tShape executed with errors in 1234 ms")
    lines.append(f"{end_time}\tSEVERE\tProcess\t{error_step}\t{error_msg}")

    # Additional errors (e.g. dm-005 multiple errors scenario)
    for extra in mock.get("additionalErrors", []):
        lines.append(f"{end_time}\tSEVERE\tProcess\t{extra.get('errorStep', 'Unknown')}\t{extra.get('errorMessage', '')}")

    retry_count = mock.get("retryCount", 0)
    for i in range(retry_count):
        lines.append(f"{end_time}\tINFO\tProcess\t\tretry {i+1} of {retry_count}")

    log_content = "\n".join(lines) + "\n"

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False,
                                      prefix=f"boomi_mock_{exec_id}_")
    tmp.write(log_content)
    tmp.close()
    print(f"  Mock log written to: {tmp.name}\n")
    return tmp.name


# ── Boomi API fetch ───────────────────────────────────────────
def boomi_fetch(process_name, hours=24, status="ERROR"):
    """
    Live mode: fetches execution records and log from the Boomi Platform API.
    Requires env vars: BOOMI_ACCOUNT_ID, BOOMI_TOKEN, BOOMI_ATOM
    """
    account  = os.environ.get("BOOMI_ACCOUNT_ID")
    token    = os.environ.get("BOOMI_TOKEN")
    atom_id  = os.environ.get("BOOMI_ATOM")

    if not all([account, token, atom_id]):
        print("\n  Missing env vars. Run:")
        print("  echo 'export BOOMI_ACCOUNT_ID=YOUR_ACCOUNT_ID' >> ~/.zshrc")
        print("  echo 'export BOOMI_TOKEN=user@example.com:your-api-token' >> ~/.zshrc")
        print("  echo 'export BOOMI_ATOM=YOUR_ATOM_ID' >> ~/.zshrc")
        sys.exit(1)

    print(f"\n  Fetching executions for: {process_name}")
    print(f"  Status: {status} | Last {hours}h | Prod atom")

    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

    query = {
        "QueryFilter": {
            "expression": {
                "operator": "and",
                "nestedExpression": [
                    {"argument": [process_name], "operator": "EQUALS", "property": "processName"},
                    {"argument": [status], "operator": "EQUALS", "property": "status"},
                    {"argument": [atom_id], "operator": "EQUALS", "property": "atomId"},
                    {"argument": [since], "operator": "GREATER_THAN_OR_EQUAL", "property": "executionTime"}
                ]
            }
        }
    }

    url = f"https://api.boomi.com/api/rest/v1/{account}/ExecutionRecord/query"
    req = urllib.request.Request(
        url,
        data=json.dumps(query).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": "Basic " + __import__("base64").b64encode(token.encode()).decode()
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"\n  API error {e.code}: {e.read().decode()}")
        sys.exit(1)

    records = result.get("result", [])
    if not records:
        print(f"\n  No {status} executions found for \"{process_name}\" on Prod.\n")
        sys.exit(0)

    print(f"  Found {len(records)} execution(s) — fetching latest log...\n")

    latest = records[0]
    exec_id = latest.get("executionId")
    exec_time = latest.get("executionTime", "unknown time")
    print(f"  Execution ID : {exec_id}")
    print(f"  Execution time: {exec_time}")
    print(f"  Duration     : {latest.get('executionDuration', '?')}ms")
    print(f"  Status       : {latest.get('status', '?')}")

    import io, time
    auth = "Basic " + __import__("base64").b64encode(token.encode()).decode()

    log_req_url = f"https://api.boomi.com/api/rest/v1/{account}/ProcessLog"
    payload = json.dumps({"executionId": exec_id}).encode("utf-8")
    log_req = urllib.request.Request(
        log_req_url,
        data=payload,
        headers={
            "Authorization": auth,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(log_req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            download_url = result.get("url")
            if not download_url:
                print(f"\n  No download URL returned: {result}")
                sys.exit(1)
            print(f"  Download URL received, downloading log...")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"\n  Failed to request log: {e.code} {body}")
        sys.exit(1)

    print(f"  Waiting for log to be ready", end="", flush=True)
    raw = None
    for attempt in range(30):
        time.sleep(3)
        dl_req = urllib.request.Request(
            download_url,
            headers={"Authorization": auth}
        )
        try:
            with urllib.request.urlopen(dl_req) as resp:
                status_code = resp.status
                raw = resp.read()
                if status_code == 200 and len(raw) > 0:
                    print(f" done ({len(raw)} bytes).")
                    break
                else:
                    print(".", end="", flush=True)
        except urllib.error.HTTPError as e:
            if e.code == 202:
                print(".", end="", flush=True)
                continue
            elif e.code == 404:
                print(f"\n  Download URL expired, re-requesting...")
                log_req2 = urllib.request.Request(
                    log_req_url,
                    data=payload,
                    headers={
                        "Authorization": auth,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(log_req2) as r2:
                    result2 = json.loads(r2.read().decode("utf-8"))
                    download_url = result2.get("url")
                    print(f"  New URL obtained, retrying...")
                continue
            else:
                body = e.read().decode()
                print(f"\n  Failed to download log: {e.code} {body}")
                sys.exit(1)

    if not raw or len(raw) == 0:
        print(f"\n  Log is empty — Boomi did not write a log for this execution.")
        print(f"  This is common for timeout/cancellation errors.")
        print(f"  Execution summary: {process_name} | {exec_time} | {latest.get('executionDuration','?')}ms | {status}")
        sys.exit(0)

    if raw[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(raw))
        log_files = [f for f in z.namelist() if f.endswith(".log")] or z.namelist()
        if not log_files:
            print("\n  No files found inside zip.")
            sys.exit(1)
        log_content = z.read(log_files[0]).decode("utf-8", errors="replace")
        print(f"  Extracted: {log_files[0]}")
    else:
        log_content = raw.decode("utf-8", errors="replace")

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False,
                                      prefix=f"boomi_{exec_id}_")
    tmp.write(log_content)
    tmp.close()
    print(f"  Log saved to: {tmp.name}\n")
    return tmp.name


def boomi_fetch_by_exec_id(exec_id):
    """Fetch a specific execution log by execution ID (live mode only)."""
    account = os.environ.get("BOOMI_ACCOUNT_ID")
    token   = os.environ.get("BOOMI_TOKEN")

    if not all([account, token]):
        print("\n  Missing env vars: BOOMI_ACCOUNT_ID and BOOMI_TOKEN required.")
        sys.exit(1)

    import io, time
    auth = "Basic " + __import__("base64").b64encode(token.encode()).decode()
    log_req_url = f"https://api.boomi.com/api/rest/v1/{account}/ProcessLog"
    payload = json.dumps({"executionId": exec_id}).encode("utf-8")

    print(f"\n  Fetching log for execution ID: {exec_id}")
    log_req = urllib.request.Request(
        log_req_url,
        data=payload,
        headers={
            "Authorization": auth,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(log_req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            download_url = result.get("url")
            if not download_url:
                print(f"\n  No download URL returned.")
                sys.exit(1)
    except urllib.error.HTTPError as e:
        print(f"\n  Failed to request log: {e.code} {e.read().decode()}")
        sys.exit(1)

    print(f"  Waiting for log", end="", flush=True)
    raw = None
    for _ in range(30):
        time.sleep(3)
        try:
            with urllib.request.urlopen(urllib.request.Request(download_url, headers={"Authorization": auth})) as resp:
                raw = resp.read()
                if resp.status == 200 and len(raw) > 0:
                    print(f" done.")
                    break
                print(".", end="", flush=True)
        except urllib.error.HTTPError as e:
            if e.code == 202:
                print(".", end="", flush=True)
            else:
                print(f"\n  Error: {e.code}")
                sys.exit(1)

    if not raw:
        print("\n  Empty log.")
        sys.exit(0)

    if raw[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(raw))
        log_files = [f for f in z.namelist() if f.endswith(".log")] or z.namelist()
        log_content = z.read(log_files[0]).decode("utf-8", errors="replace")
    else:
        log_content = raw.decode("utf-8", errors="replace")

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False, prefix=f"boomi_{exec_id}_")
    tmp.write(log_content)
    tmp.close()
    print(f"  Log saved to: {tmp.name}\n")
    return tmp.name


# ── System classifier ────────────────────────────────────────
SYSTEM_PATTERNS = [
    (r"netsuite|netsuitesdk|NetSuite",                                      "NetSuite"),
    (r"salesforce|SFDC|sfdc|Salesforce",                                    "Salesforce"),
    (r"snowflake|Snowflake",                                                 "Snowflake"),
    (r"marketo|Marketo",                                                     "Marketo"),
    (r"D2L|d2l|brightspace",                                                 "D2L / LMS"),
    (r"sitecore|Sitecore",                                                   "Sitecore"),
    (r"freshservice|Freshservice",                                           "Freshservice"),
    (r"MemberPort|memberport",                                               "MemberPortal"),
    (r"Janison|janison|CONN - Janison",                                      "Janison"),
    (r"fss Connector|boomi flow|Flow Service|flowservice",                   "Boomi Flow"),
    (r"SF Request Exception|SF Response|SF Path|SFDC",                       "Salesforce"),
    (r"Conflict.*enrolment|enrolment.*conflict|409",                         "Janison"),
    (r"http Connector|HTTP|REST|API|queue Connector",                        "Integration / API"),
    (r"com\.boomi|boomi|SimpleMessageQueue|CancellationException|BatchTask", "Boomi Platform"),
]

DATA_ERROR_PATTERNS = [
    r"Invalid.*reference|Invalid.*key|Invalid.*ID",
    r"Error Parsing Date|Unparseable date|date format",
    r"NullPointerException|null.*value|missing.*field|required.*field",
    r"No documents found|0 document",
    r"does not exist|not found|404",
    r"duplicate|already exists",
    r"mapping.*fail|map.*error|profile.*error",
    r"Bad Request|400",
    r"corrupt|invalid.*data|malformed",
    r"already exists|Enrolment already exists|Conflict occurred|409",
    r"Nonexistent externalId|nonexistent.*id|upsert failed",
    r"cannot.*convert|conversion.*fail",
    r"File Size|file size|size limit|can only be uploaded|not allowed|not permitted|halt all documents",
]

def classify_system(shape, message, detail=""):
    combined = f"{shape} {message} {detail}"
    for pattern, label in SYSTEM_PATTERNS:
        if re.search(pattern, combined, re.IGNORECASE):
            return label
    return "Unknown System"

def is_data_error(message):
    for pattern in DATA_ERROR_PATTERNS:
        if re.search(pattern, message, re.IGNORECASE):
            return True
    return False

# ── Known error pattern matchers ─────────────────────────────
ERROR_PATTERNS = [
    (r"HTTP[s]? (\d{3})|Code (\d{3})",                          "HTTP Error"),
    (r"Error Parsing Date '([^']+)'.*Expected Format ([^\s;]+)", "Date Format Mismatch"),
    (r"exceeded maximum execution time",                          "Execution Timeout"),
    (r"Could not add message to batch queue",                     "Batch Queue Interruption"),
    (r"Connection refused|Connection timed out|SocketTimeout",    "Connection Failure"),
    (r"NullPointerException",                                     "Null Pointer / Missing Data"),
    (r"OutOfMemoryError",                                         "Out of Memory"),
    (r"CancellationException",                                    "Process Cancelled"),
    (r"Unparseable date",                                         "Unparseable Date"),
    (r"401|403|Unauthorized|Forbidden",                           "Auth Failure"),
    (r"No documents found",                                       "No Output Documents"),
    (r"document error",                                           "Document Error"),
    (r"Invalid.*reference|Invalid.*key|Invalid.*ID",              "Invalid Reference / Bad Data"),
    (r"does not exist|not found",                                 "Record Not Found"),
    (r"duplicate|already exists|Enrolment already exists",        "Duplicate / Already Exists"),
    (r"Conflict occurred|409|CONFLICT",                           "Conflict / Duplicate Enrolment"),
    (r"required.*field|missing.*field",                           "Missing Required Field"),
    (r"Nonexistent externalId|nonexistent.*id|externalId.*not found", "Invalid Reference / Bad Data"),
    (r"upsert failed|Upsert failed",                              "Upsert Failed"),
    (r"File Size|file size|size limit|size exceeded",             "Validation Error / File Size"),
    (r"can only be uploaded|not allowed|not permitted|not supported", "Validation Error / Business Rule"),
    (r"halting.*document|halt all documents|process terminating", "Process Halted / Exception"),
]

def classify_error(message):
    for pattern, label in ERROR_PATTERNS:
        if re.search(pattern, message, re.IGNORECASE):
            return label
    return "Unknown Error"

def parse_ts(ts_str):
    try:
        return datetime.strptime(ts_str.strip(), "%Y-%m-%dT%H:%M:%SZ")
    except:
        return None

def wrap(text, width=75, indent="             "):
    words = text.split()
    lines, current = [], ""
    for word in words:
        if len(current) + len(word) + 1 > width:
            lines.append(current)
            current = word
        else:
            current = (current + " " + word).strip()
    if current:
        lines.append(current)
    return ("\n" + indent).join(lines)

def scan(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw_lines = f.readlines()

    parsed = []
    for i, line in enumerate(raw_lines):
        parts = line.strip().split("\t")
        if len(parts) < 3:
            continue
        ts      = parse_ts(parts[0])
        level   = parts[1].strip() if len(parts) > 1 else ""
        shape   = parts[2].strip() if len(parts) > 2 else ""
        detail  = parts[3].strip() if len(parts) > 3 else ""
        message = parts[4].strip() if len(parts) > 4 else ""
        parsed.append({"lineno": i+1, "ts": ts, "level": level,
                        "shape": shape, "detail": detail, "message": message, "raw": line.strip()})

    if not parsed:
        print("  No parseable lines found.")
        return

    process_name = ""
    for p in parsed:
        m = re.search(r"Executing Process (.+?)(?:\s*\(|$)", p["message"])
        if m:
            process_name = m.group(1).strip()
            break

    timestamps = [p["ts"] for p in parsed if p["ts"]]
    start_time = min(timestamps) if timestamps else None
    end_time   = max(timestamps) if timestamps else None
    duration   = int((end_time - start_time).total_seconds()) if start_time and end_time else None

    errors   = [p for p in parsed if p["level"] == "SEVERE"]
    warnings = [p for p in parsed if p["level"] == "WARNING"]

    shape_times = {}
    for p in parsed:
        m = re.search(r"Shape executed (?:successfully|with errors) in (\d+) ms", p["message"])
        if m and p["shape"]:
            ms = int(m.group(1))
            key = p["detail"] or p["shape"]
            if key not in shape_times or ms > shape_times[key]:
                shape_times[key] = ms
    slowest = sorted(shape_times.items(), key=lambda x: x[1], reverse=True)[:5]

    retries = len(re.findall(r"retry \d+", "\n".join([p["raw"] for p in parsed]), re.IGNORECASE))

    doc_counts = re.findall(r"Executing .+ with (\d+) document", "\n".join([p["message"] for p in parsed]))
    max_docs = max([int(d) for d in doc_counts], default=0)

    first_error = errors[0] if errors else None
    first_error_type = classify_error(first_error["message"]) if first_error else None

    http_codes = re.findall(r"Code (\d{3})", "\n".join([p["message"] for p in parsed]))

    status = "✅ PASSED" if not errors else "❌ FAILED"
    failed_docs_match = re.search(r"encountered (\d+) document error",
                                   "\n".join([p["message"] for p in parsed]))
    failed_docs = int(failed_docs_match.group(1)) if failed_docs_match else len(errors) if errors else 0
    succeeded_docs = max_docs - failed_docs if max_docs and failed_docs else None
    partial = succeeded_docs is not None and succeeded_docs > 0 and failed_docs > 0

    seen_msgs = set()
    unique_errors = []
    for p in errors:
        key = p['message'].split("\n")[0][:120]
        if key not in seen_msgs:
            seen_msgs.add(key)
            unique_errors.append(p)

    div = "=" * 65
    sep = "-" * 65

    print(f"\n{div}")
    print(f"  BOOMI LOG SCANNER")
    print(f"{div}")
    print(f"  Process  : {process_name or 'Unknown'}")
    print(f"  Status   : {status}" + (" (partial)" if partial else ""))
    print(f"  Started  : {start_time.strftime('%Y-%m-%d %H:%M:%S UTC') if start_time else 'Unknown'}")
    print(f"  Duration : {duration}s" if duration else "  Duration : Unknown")
    if partial:
        print(f"  Docs     : {succeeded_docs} of {max_docs} succeeded, {failed_docs} failed")
    else:
        print(f"  Docs     : {max_docs:,}")
    if retries:
        print(f"  Retries  : {retries}")
    if http_codes:
        print(f"  HTTP     : {', '.join(set(http_codes))}")
    print(f"{div}\n")

    if first_error:
        system   = classify_system(first_error['shape'], first_error['message'], first_error['detail'])
        data_err = is_data_error(first_error['message'])
        origin   = "💾 Data / Content Error" if data_err else "⚙️  System / Platform Error"

        print(f"🔍 ROOT CAUSE")
        print(sep)
        print(f"  Error type : {first_error_type}")
        print(f"  System     : {system}")
        print(f"  Origin     : {origin}")
        print(f"  Shape      : {first_error['detail'] or first_error['shape'] or 'Process'}")
        msg = first_error['message']
        clean = []
        for l in msg.split("\n"):
            if l.strip().startswith("at com.boomi") or l.strip().startswith("at java"):
                break
            clean.append(l.strip())
        msg_clean = " | ".join([l for l in clean if l])
        print(f"  Message    : {wrap(msg_clean)}")
        print()
        conflict = bool(re.search(r"already exists|Conflict occurred|409|duplicate", first_error['message'], re.IGNORECASE))
        if conflict:
            print(f"  ℹ️  Duplicate / conflict in {system} — record already exists.")
            print(f"     Retrying will NOT fix this — check upstream for duplicate submissions.")
        elif data_err:
            print(f"  ℹ️  Bad/missing/invalid data in {system}.")
            print(f"     Retrying will NOT fix this — data needs to be corrected first.")
        else:
            print(f"  ℹ️  Platform or connectivity issue in {system}.")
            print(f"     Retrying MAY help if this was a transient failure.")
        print()

    if unique_errors and len(unique_errors) > 1:
        print(f"❌ OTHER ERRORS ({len(unique_errors) - 1})")
        print(sep)
        for p in unique_errors[1:]:
            msg = p['message'].split("\n")[0][:300]
            shape_label = p['detail'] or p['shape'] or 'Process'
            sys_label   = classify_system(p['shape'], p['message'], p['detail'])
            data_flag   = "💾 Data Error" if is_data_error(p['message']) else "⚙️ System Error"
            print(f"  Line {p['lineno']:>5} | {shape_label}")
            print(f"           → {wrap(msg)}")
            print(f"           ↳ [{classify_error(p['message'])}] [{sys_label}] [{data_flag}]")
            print()

    if warnings and not errors:
        print(f"⚠️  WARNINGS ({len(warnings)})")
        print(sep)
        for p in warnings:
            shape_label = p['detail'] or p['shape'] or 'Process'
            print(f"  Line {p['lineno']:>5} | {shape_label}")
            print(f"           → {p['message'][:200]}")
            print()

    if slowest:
        print(f"🐢 SLOWEST SHAPES (top {len(slowest)})")
        print(sep)
        for name, ms in slowest:
            bar = "█" * min(int(ms / 200), 30)
            print(f"  {ms:>6} ms  {name[:45]:<45} {bar}")
        print()

    if retries:
        print(f"🔄 RETRIES: {retries} attempt(s) — all failed, retrying won't fix this")
        print()

    if not errors and not warnings:
        print("  ✅ No errors or warnings — process completed cleanly.\n")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Boomi Log Scanner")
    parser.add_argument("path", nargs="?", help="Log file path (optional — auto-detects latest)")
    parser.add_argument("--fetch", action="store_true", help="Fetch log from Boomi API (live mode)")
    parser.add_argument("--process", help="Process name to fetch (required with --fetch or --mock)")
    parser.add_argument("--mock", action="store_true", help="Use prototype mock data instead of live API")
    parser.add_argument("--dep-map", default="dependency_map_synthetic.json",
                        help="Path to dependency_map_synthetic.json (used with --mock, default: ./dependency_map_synthetic.json)")
    parser.add_argument("--status", default="ERROR", help="Execution status filter (default: ERROR)")
    parser.add_argument("--hours", type=int, default=24, help="Look back N hours (default: 24)")
    args = parser.parse_args()

    # Prototype mode: env flag or --mock argument
    prototype_mode = args.mock or os.environ.get("PROTOTYPE_MODE", "").lower() in ("true", "1", "yes")

    if prototype_mode:
        if not args.process:
            print()
            args.process = input("  Enter process name (prototype mode): ").strip()
            if not args.process:
                print("  No process name entered. Exiting.\n")
                sys.exit(1)
        dep_map_path = os.environ.get("DEPENDENCY_MAP_PATH", args.dep_map)
        path = boomi_fetch_mock(args.process, dependency_map_path=dep_map_path)
    elif args.fetch:
        if not args.process:
            print()
            args.process = input("  Enter process name: ").strip()
            if not args.process:
                print("  No process name entered. Exiting.\n")
                sys.exit(1)
        path = boomi_fetch(args.process, hours=args.hours, status=args.status)
    else:
        path = args.path or find_latest()
        if not path:
            print("\n  Error: no log or zip found in ~/Downloads\n")
            sys.exit(1)
        if not os.path.exists(path):
            print(f"\n  Error: file not found — {path}\n")
            sys.exit(1)

    scan(path)

if __name__ == "__main__":
    main()
