# System Requirements

These guidelines describe the virtual workspace and
software used to run the CAANZ prototype. They are based on the supplied
workspace specifications, the AWS workspace repository and this project's current
dependencies. 

## Virtual workspace specifications

| Component | Supplied baseline |
| --- | --- |
| Platform | Amazon WorkSpaces |
| Compute | 2 vCPUs |
| Memory | 8 GiB RAM |
| OS | `Windows10` |
| Root storage | 80 GiB |
| User storage | 10 GiB |

The workspace configuration also specifies automatic stopping after 120 minutes of inactivity and enables
internet access and local administrator permissions.

**Compute needs confirmation:** the workspace can be deployed with either the `PERFORMANCE` (2 vCPU / 8 GiB) or `POWER` (4 vCPUs / 16 GiB) resource bundles. See [AWS bundle specifications](https://docs.aws.amazon.com/workspaces/latest/adminguide/bundle-options.html). These are supplied provisioning specifications, not a measured minimum or a performance guarantee.

## Required software

| Software | Requirement or purpose |
| --- | --- |
| Amazon WorkSpaces client | Connect to the assigned virtual desktop; obtain it from the [client download page](https://clients.amazonworkspaces.com/) |
| Visual Studio Code | Edit project files; included in the documented first-login installation |
| Git | Retrieve and update the project; repository access must be provided |
| Linux-compatible Python environment | macOS, Linux or WSL; the current backend imports Unix `fcntl` for fixture locking and cannot run directly in native Windows Python |
| Python | 3.14 or newer, as declared in `pyproject.toml` |
| uv | Install Python and synchronize the project's locked Python dependencies |
| Node.js and npm | Node.js 20.9 or newer is the dashboard dependency minimum; use a currently supported LTS release from the [Node.js download page](https://nodejs.org/en/download) |
| Web browser | Access the local dashboard and API documentation |

The project uses local JSON fixtures and SQLite sessions. No separate database
server or local model installation is required. Python libraries are installed
through `uv sync`; dashboard libraries are installed through npm.

## Prepare the Windows workspace

### 1. Complete the first-login installation

Install VSCode, Git, and SQL Lite (either manually or using the following powershell commands).

```bash
# Install VSCode
Write-Output "Installing Visual Studio Code..."
Start-Process "C:\Scripts\VSCodeUserSetup-x64-1.101.2.exe" -ArgumentList "/VERYSILENT /MERGETASKS=!runcode" -Wait

# Install Git
Write-Output "Installing Git..."
Start-Process "C:\Scripts\Git-2.50.0.2-64-bit.exe" -ArgumentList "/VERYSILENT /NORESTART" -Wait

# Install Python 3
Write-Output "Installing Python 3..."
Start-Process "c:\Scripts\python-3.12.2-amd64.exe" -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait

# Install SQL Lite
Write-Output "Installing SQLite..."
Expand-Archive -Path "C:\Scripts\sqlite-tools-win32-x86-3420000.zip" -DestinationPath "$env:ProgramFiles\SQLite" -Force
# Add SQLite to PATH
$env:Path += ";$env:ProgramFiles\SQLite"
```

### 2. Install uv and Node.js

Inside the Linux environment, install uv using the
[official installation instructions](https://docs.astral.sh/uv/getting-started/installation/):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Restart the terminal so uv is available on `PATH`, then install Python:

```bash
uv --version
uv python install 3.14
```

Install a supported Node.js LTS release and npm in the same Linux environment
using the [Node.js download instructions](https://nodejs.org/en/download).
Verify `node --version` is at least 20.9 and `npm --version` succeeds.

For reference, the workspace README provides this Windows uv installation command:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Install Node.js using the Windows `.msi` installer from the website.
Those steps install Windows tools; use the Linux installations for the setup above.