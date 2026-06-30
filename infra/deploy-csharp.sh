#!/usr/bin/env bash
# =====================================================================
# deploy-csharp.sh — Build and deploy both .NET 8 Lambda functions.
# Run from AWS CloudShell or any environment with dotnet 8 and aws CLI.
# =====================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Checking dotnet version..."
if ! command -v dotnet &>/dev/null; then
  echo "ERROR: dotnet CLI not found. Use an environment with .NET 8 (e.g. amazon/aws-lambda-dotnet:8)."
  exit 1
fi
DOTNET_VER=$(dotnet --version 2>/dev/null || echo "0")
if [[ "${DOTNET_VER%%.*}" -lt 8 ]]; then
  echo "ERROR: dotnet 8 required; found $DOTNET_VER"
  exit 1
fi
echo "  dotnet $DOTNET_VER OK"

# Check for dotnet lambda tool
if ! dotnet tool list -g 2>/dev/null | grep -q "amazon.lambda.tools"; then
  echo "==> Installing Amazon.Lambda.Tools..."
  dotnet tool install -g Amazon.Lambda.Tools
  export PATH="$PATH:$HOME/.dotnet/tools"
fi

# ---- TransportApi ----
echo ""
echo "==> Building TransportApi..."
cd "$REPO_ROOT/lambda/TransportApi"
dotnet restore
dotnet lambda package -o /tmp/transport-api.zip

echo "==> Deploying TransportApi code..."
aws lambda update-function-code \
  --function-name psiog-transport-api \
  --zip-file fileb:///tmp/transport-api.zip \
  --output text

echo "==> Waiting for TransportApi code update..."
aws lambda wait function-updated --function-name psiog-transport-api

echo "==> Updating TransportApi configuration..."
aws lambda update-function-configuration \
  --function-name psiog-transport-api \
  --runtime dotnet8 \
  --handler "TransportApi::TransportApi.Function::FunctionHandler" \
  --output text

echo "==> Waiting for TransportApi configuration update..."
aws lambda wait function-updated --function-name psiog-transport-api

echo "  TransportApi deployed OK"

# ---- VoiceAgent ----
echo ""
echo "==> Building VoiceAgent..."
cd "$REPO_ROOT/lambda/VoiceAgent"
dotnet restore
dotnet lambda package -o /tmp/voice-agent.zip

echo "==> Deploying VoiceAgent code..."
aws lambda update-function-code \
  --function-name psiog-voice-agent \
  --zip-file fileb:///tmp/voice-agent.zip \
  --output text

echo "==> Waiting for VoiceAgent code update..."
aws lambda wait function-updated --function-name psiog-voice-agent

echo "==> Updating VoiceAgent configuration..."
aws lambda update-function-configuration \
  --function-name psiog-voice-agent \
  --runtime dotnet8 \
  --handler "VoiceAgent::VoiceAgent.Function::FunctionHandler" \
  --output text

echo "==> Waiting for VoiceAgent configuration update..."
aws lambda wait function-updated --function-name psiog-voice-agent

echo "  VoiceAgent deployed OK"

echo ""
echo "==> All done. Both Lambda functions updated to dotnet8."
