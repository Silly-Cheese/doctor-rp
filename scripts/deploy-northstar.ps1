# Northstar Medical Center: deploy backend services to the confirmed Firebase project.
# Run from the repository root in PowerShell with an authenticated Firebase CLI.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectId = "doctor-rp"
Set-Location (Join-Path $PSScriptRoot "..")
Write-Host "Northstar backend deployment target: $projectId"
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw "Firebase CLI is not installed. Run: npm install -g firebase-tools"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js/npm is not installed."
}
$configured = Select-String -Path "app.js" -Pattern 'projectId: "doctor-rp"' -SimpleMatch
if (-not $configured) {
  throw "Refusing to deploy: app.js is not configured for the expected doctor-rp Firebase project."
}
Write-Host "Installing functions dependencies..."
npm --prefix functions install
if ($LASTEXITCODE -ne 0) { throw "Functions dependency installation failed." }
Write-Host "Deploying Firestore rules and Cloud Functions..."
firebase deploy --project $projectId --only "firestore:rules,functions"
if ($LASTEXITCODE -ne 0) { throw "Firebase deployment failed. Review output above." }
Write-Host "Listing deployed Cloud Functions..."
firebase functions:list --project $projectId
if ($LASTEXITCODE -ne 0) { throw "Deployment succeeded but function verification failed." }
Write-Host "Northstar backend deployment command completed successfully."
