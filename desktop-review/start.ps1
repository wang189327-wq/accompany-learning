$ErrorActionPreference='Stop'
# Credentials remain under the user's home directory, never in this project.
& node (Join-Path $PSScriptRoot 'worker.cjs')
