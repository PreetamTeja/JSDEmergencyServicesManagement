#!/usr/bin/env bash
# =====================================================================
# Create a CodePipeline that auto-builds + deploys the SPA to S3/CloudFront
# on every commit to the CodeCommit repo.
#
#   Pipeline:  CodeCommit (source)  ->  CodeBuild (npm build + s3 sync + CF invalidate)
#
# Run in AWS CloudShell AFTER setup-codecommit.sh has created + pushed the repo:
#
#   REPO=jsd-emergency \
#   S3_BUCKET=<your-spa-bucket> \
#   CLOUDFRONT_DISTRIBUTION_ID=<your-dist-id> \
#   VITE_API_URL=https://cfnjgxlvfl.execute-api.eu-west-1.amazonaws.com \
#   VITE_COGNITO_REGION=eu-central-1 \
#   VITE_COGNITO_USER_POOL_ID=eu-central-1_74er6Yfnf \
#   VITE_COGNITO_CLIENT_ID=3t356v1nm5dq54kbthttjev21l \
#   VITE_COGNITO_DOMAIN=https://eu-central-174er6yfnf.auth.eu-central-1.amazoncognito.com \
#   VITE_ADMIN_GROUPS=transport-admin \
#   VITE_MAIN_APP_URL=http://localhost:5173 \
#   VITE_POWERBI_SECURE=true \
#   VITE_POWERBI_EMBED_URL= \
#   VITE_VOICE_URL= \
#   AWS_REGION=eu-west-1 ./setup-pipeline.sh
# =====================================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
REPO="${REPO:-jsd-emergency}"
BRANCH="${BRANCH:-main}"
PROJECT="${PROJECT:-${REPO}-build}"
PIPELINE="${PIPELINE:-${REPO}-pipeline}"
S3_BUCKET="${S3_BUCKET:?Set S3_BUCKET to your SPA hosting bucket}"
CF_ID="${CLOUDFRONT_DISTRIBUTION_ID:?Set CLOUDFRONT_DISTRIBUTION_ID}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

# Artifact bucket for CodePipeline (separate from the SPA bucket).
ART_BUCKET="${ART_BUCKET:-${REPO}-pipeline-artifacts-${ACCOUNT}}"

echo "Region=${REGION} Repo=${REPO} Project=${PROJECT} Pipeline=${PIPELINE}"
echo "SPA bucket=${S3_BUCKET}  CloudFront=${CF_ID}  Artifacts=${ART_BUCKET}"

# ---- 0) artifact bucket ----
aws s3api head-bucket --bucket "$ART_BUCKET" 2>/dev/null || \
  aws s3api create-bucket --bucket "$ART_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
echo "Artifact bucket ready: ${ART_BUCKET}"

# ---- 1) IAM role for CodeBuild ----
CB_ROLE="${PROJECT}-role"
if ! aws iam get-role --role-name "$CB_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$CB_ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam put-role-policy --role-name "$CB_ROLE" --policy-name build-deploy --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":"*"},
  {"Effect":"Allow","Action":["s3:GetObject","s3:GetObjectVersion","s3:PutObject","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::${ART_BUCKET}","arn:aws:s3:::${ART_BUCKET}/*"]},
  {"Effect":"Allow","Action":["s3:PutObject","s3:DeleteObject","s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::${S3_BUCKET}","arn:aws:s3:::${S3_BUCKET}/*"]},
  {"Effect":"Allow","Action":["cloudfront:CreateInvalidation"],"Resource":"*"}
]}
JSON
)"

# ---- 2) IAM role for CodePipeline ----
CP_ROLE="${PIPELINE}-role"
if ! aws iam get-role --role-name "$CP_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$CP_ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codepipeline.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam put-role-policy --role-name "$CP_ROLE" --policy-name pipeline --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:GetObject","s3:GetObjectVersion","s3:PutObject","s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::${ART_BUCKET}","arn:aws:s3:::${ART_BUCKET}/*"]},
  {"Effect":"Allow","Action":["codecommit:GetBranch","codecommit:GetCommit","codecommit:UploadArchive","codecommit:GetUploadArchiveStatus","codecommit:CancelUploadArchive","codecommit:GetRepository"],"Resource":"arn:aws:codecommit:${REGION}:${ACCOUNT}:${REPO}"},
  {"Effect":"Allow","Action":["codebuild:BatchGetBuilds","codebuild:StartBuild"],"Resource":"*"}
]}
JSON
)"
echo "Waiting for IAM role propagation..."; sleep 12
CB_ROLE_ARN="$(aws iam get-role --role-name "$CB_ROLE" --query Role.Arn --output text)"
CP_ROLE_ARN="$(aws iam get-role --role-name "$CP_ROLE" --query Role.Arn --output text)"

# ---- 3) CodeBuild project (env vars baked in for the Vite build) ----
mkenv() { printf '{"name":"%s","value":"%s","type":"PLAINTEXT"}' "$1" "${2:-}"; }
ENVVARS="$(cat <<JSON
[
  $(mkenv S3_BUCKET "$S3_BUCKET"),
  $(mkenv CLOUDFRONT_DISTRIBUTION_ID "$CF_ID"),
  $(mkenv VITE_API_URL "${VITE_API_URL:-}"),
  $(mkenv VITE_MAIN_APP_URL "${VITE_MAIN_APP_URL:-}"),
  $(mkenv VITE_COGNITO_REGION "${VITE_COGNITO_REGION:-}"),
  $(mkenv VITE_COGNITO_USER_POOL_ID "${VITE_COGNITO_USER_POOL_ID:-}"),
  $(mkenv VITE_COGNITO_CLIENT_ID "${VITE_COGNITO_CLIENT_ID:-}"),
  $(mkenv VITE_COGNITO_DOMAIN "${VITE_COGNITO_DOMAIN:-}"),
  $(mkenv VITE_ADMIN_GROUPS "${VITE_ADMIN_GROUPS:-}"),
  $(mkenv VITE_POWERBI_SECURE "${VITE_POWERBI_SECURE:-}"),
  $(mkenv VITE_POWERBI_EMBED_URL "${VITE_POWERBI_EMBED_URL:-}"),
  $(mkenv VITE_VOICE_URL "${VITE_VOICE_URL:-}")
]
JSON
)"

ENV_JSON="$(cat <<JSON
{"type":"LINUX_CONTAINER","image":"aws/codebuild/amazonlinux2-x86_64-standard:5.0","computeType":"BUILD_GENERAL1_SMALL","environmentVariables":${ENVVARS}}
JSON
)"

if aws codebuild batch-get-projects --names "$PROJECT" --region "$REGION" \
     --query 'projects[0].name' --output text 2>/dev/null | grep -q "$PROJECT"; then
  aws codebuild update-project --name "$PROJECT" --region "$REGION" \
    --source '{"type":"CODEPIPELINE","buildspec":"buildspec.yml"}' \
    --artifacts '{"type":"CODEPIPELINE"}' \
    --environment "$ENV_JSON" --service-role "$CB_ROLE_ARN" >/dev/null
  echo "Updated CodeBuild project ${PROJECT}."
else
  aws codebuild create-project --name "$PROJECT" --region "$REGION" \
    --source '{"type":"CODEPIPELINE","buildspec":"buildspec.yml"}' \
    --artifacts '{"type":"CODEPIPELINE"}' \
    --environment "$ENV_JSON" --service-role "$CB_ROLE_ARN" >/dev/null
  echo "Created CodeBuild project ${PROJECT}."
fi

# ---- 4) CodePipeline (CodeCommit source -> CodeBuild) ----
PIPE_JSON="$(cat <<JSON
{
  "pipeline": {
    "name": "${PIPELINE}",
    "roleArn": "${CP_ROLE_ARN}",
    "artifactStore": {"type":"S3","location":"${ART_BUCKET}"},
    "stages": [
      {"name":"Source","actions":[{
        "name":"Source","actionTypeId":{"category":"Source","owner":"AWS","provider":"CodeCommit","version":"1"},
        "configuration":{"RepositoryName":"${REPO}","BranchName":"${BRANCH}","PollForSourceChanges":"false"},
        "outputArtifacts":[{"name":"SourceOutput"}]}]},
      {"name":"Build","actions":[{
        "name":"Build","actionTypeId":{"category":"Build","owner":"AWS","provider":"CodeBuild","version":"1"},
        "configuration":{"ProjectName":"${PROJECT}"},
        "inputArtifacts":[{"name":"SourceOutput"}],"outputArtifacts":[{"name":"BuildOutput"}]}]}
    ]
  }
}
JSON
)"

printf '%s' "$PIPE_JSON" > /tmp/pipeline.json
if aws codepipeline get-pipeline --name "$PIPELINE" --region "$REGION" >/dev/null 2>&1; then
  aws codepipeline update-pipeline --region "$REGION" --cli-input-json file:///tmp/pipeline.json >/dev/null
  echo "Updated pipeline ${PIPELINE}."
else
  aws codepipeline create-pipeline --region "$REGION" --cli-input-json file:///tmp/pipeline.json >/dev/null
  echo "Created pipeline ${PIPELINE}."
fi

# ---- 5) EventBridge rule so commits trigger the pipeline (CLI doesn't auto-create it) ----
EVENT_ROLE="${PIPELINE}-event-role"
if ! aws iam get-role --role-name "$EVENT_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$EVENT_ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"events.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam put-role-policy --role-name "$EVENT_ROLE" --policy-name start-pipeline --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"codepipeline:StartPipelineExecution","Resource":"arn:aws:codepipeline:${REGION}:${ACCOUNT}:${PIPELINE}"}]}
JSON
)"
sleep 8
EVENT_ROLE_ARN="$(aws iam get-role --role-name "$EVENT_ROLE" --query Role.Arn --output text)"
RULE="${PIPELINE}-on-commit"
aws events put-rule --name "$RULE" --region "$REGION" \
  --event-pattern "$(cat <<JSON
{"source":["aws.codecommit"],"detail-type":["CodeCommit Repository State Change"],"resources":["arn:aws:codecommit:${REGION}:${ACCOUNT}:${REPO}"],"detail":{"event":["referenceCreated","referenceUpdated"],"referenceType":["branch"],"referenceName":["${BRANCH}"]}}
JSON
)" >/dev/null
aws events put-targets --rule "$RULE" --region "$REGION" \
  --targets "Id=pipeline,Arn=arn:aws:codepipeline:${REGION}:${ACCOUNT}:${PIPELINE},RoleArn=${EVENT_ROLE_ARN}" >/dev/null
echo "EventBridge trigger '${RULE}' wired to pipeline."

echo
echo "==================================================================="
echo "Pipeline ready. Every commit to CodeCommit '${REPO}' (${BRANCH}) now"
echo "auto-builds and deploys to s3://${S3_BUCKET} + invalidates ${CF_ID}."
echo "Console: https://${REGION}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${PIPELINE}/view"
echo "==================================================================="
