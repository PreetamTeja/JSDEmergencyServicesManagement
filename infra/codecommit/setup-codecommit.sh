#!/usr/bin/env bash
# =====================================================================
# Create an AWS CodeCommit repo and push this project to it.
# Run in AWS CloudShell (credentials + git-remote-codecommit already present)
# OR locally if you have the AWS CLI configured.
#
#   REPO=jsd-emergency  AWS_REGION=eu-west-1  ./setup-codecommit.sh
#
# NOTE: AWS closed CodeCommit to NEW customers in July 2024. If your account
#       has never used CodeCommit, create-repository fails with
#       OperationNotAllowedException — stay on GitHub instead.
# =====================================================================
set -euo pipefail

REPO="${REPO:-jsd-emergency}"
REGION="${AWS_REGION:-eu-west-1}"
DESC="${DESC:-JSD TATA Emergency Services Management}"
BRANCH="${BRANCH:-main}"

echo "Repo=${REPO}  Region=${REGION}"

# ---- 1) create the repository (idempotent) ----
if aws codecommit get-repository --repository-name "$REPO" --region "$REGION" >/dev/null 2>&1; then
  echo "Repository '${REPO}' already exists."
else
  aws codecommit create-repository \
    --repository-name "$REPO" \
    --repository-description "$DESC" \
    --region "$REGION" >/dev/null
  echo "Created repository '${REPO}'."
fi

# ---- 2) show the clone URLs ----
HTTPS_URL="$(aws codecommit get-repository --repository-name "$REPO" --region "$REGION" \
  --query 'repositoryMetadata.cloneUrlHttp' --output text)"
echo "HTTPS clone URL: ${HTTPS_URL}"

# ---- 3) push the current folder ----
# git-remote-codecommit (grc://) is preinstalled in CloudShell and auths via your
# IAM session — no Git credentials to manage. Falls back to the HTTPS URL otherwise.
if python3 -c "import git_remote_codecommit" >/dev/null 2>&1 || command -v git-remote-codecommit >/dev/null 2>&1; then
  GRC_URL="codecommit::${REGION}://${REPO}"
else
  echo "git-remote-codecommit not found; using HTTPS (needs IAM Git credentials)."
  GRC_URL="$HTTPS_URL"
fi

if [ ! -d .git ]; then
  git init -q
  git add -A
  git commit -qm "Initial commit: ${DESC}"
fi
git branch -M "$BRANCH"

# add or update the 'codecommit' remote, then push
if git remote get-url codecommit >/dev/null 2>&1; then
  git remote set-url codecommit "$GRC_URL"
else
  git remote add codecommit "$GRC_URL"
fi
git push -u codecommit "$BRANCH"

echo
echo "==================================================================="
echo "Pushed to CodeCommit repo '${REPO}' (branch ${BRANCH})."
echo "Console: https://${REGION}.console.aws.amazon.com/codesuite/codecommit/repositories/${REPO}/browse"
echo "==================================================================="
