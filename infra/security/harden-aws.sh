#!/usr/bin/env bash
# =====================================================================
# AWS hardening helpers. Run individual subcommands in AWS CloudShell.
#
#   ./harden-aws.sh headers                 # CloudFront security-headers policy
#   ./harden-aws.sh waf                      # WAF (rate-limit + managed rules) for CloudFront
#   ./harden-aws.sh throttle-voice <apiId>   # rate-limit the voice HTTP API stage
#   ./harden-aws.sh budget <amountUSD>       # monthly cost budget + email alarm
#   ./harden-aws.sh secrets                  # move API keys into Secrets Manager (prints ARN)
#
# Notes:
#  - WAF + the CloudFront response-headers policy are GLOBAL: use us-east-1.
#  - Attaching the policy/WebACL to the distribution is a one-time console step
#    (or via update-distribution); the script prints the IDs to use.
# =====================================================================
set -euo pipefail
CMD="${1:-help}"
REGION="${AWS_REGION:-eu-west-1}"

case "$CMD" in
  headers)
    # Strict security headers (HSTS, CSP, nosniff, frame-deny, referrer).
    # CSP connect-src must include your API + voice + Cognito hosts — edit CSP below.
    CSP="default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.execute-api.eu-west-1.amazonaws.com https://router.project-osrm.org https://cognito-idp.eu-central-1.amazonaws.com; frame-ancestors 'none'; base-uri 'self'"
    cat > /tmp/hdrs.json <<JSON
{
  "Name": "psiog-security-headers",
  "SecurityHeadersConfig": {
    "StrictTransportSecurity": {"Override": true, "IncludeSubdomains": true, "Preload": true, "AccessControlMaxAgeSec": 63072000},
    "ContentTypeOptions": {"Override": true},
    "FrameOptions": {"Override": true, "FrameOption": "DENY"},
    "ReferrerPolicy": {"Override": true, "ReferrerPolicy": "no-referrer"},
    "ContentSecurityPolicy": {"Override": true, "ContentSecurityPolicy": "${CSP}"}
  }
}
JSON
    aws cloudfront create-response-headers-policy --region us-east-1 \
      --response-headers-policy-config file:///tmp/hdrs.json \
      --query 'ResponseHeadersPolicy.Id' --output text
    echo "^ Attach this policy id to your distribution's default cache behavior (console or update-distribution)."
    ;;

  waf)
    # Rate-based rule (2000 req / 5min / IP) + AWS managed common rule set, CLOUDFRONT scope.
    cat > /tmp/waf.json <<'JSON'
[
  {"Name":"RateLimit","Priority":0,"Action":{"Block":{}},
   "Statement":{"RateBasedStatement":{"Limit":2000,"AggregateKeyType":"IP"}},
   "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"RateLimit"}},
  {"Name":"AWSCommon","Priority":1,"OverrideAction":{"None":{}},
   "Statement":{"ManagedRuleGroupStatement":{"VendorName":"AWS","Name":"AWSManagedRulesCommonRuleSet"}},
   "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"AWSCommon"}}
]
JSON
    ARN="$(aws wafv2 create-web-acl --region us-east-1 --scope CLOUDFRONT \
      --name psiog-web-acl --default-action Allow={} \
      --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=psiogWebAcl \
      --rules file:///tmp/waf.json --query 'Summary.ARN' --output text)"
    echo "WebACL ARN: $ARN"
    echo "Associate it with your CloudFront distribution (WebACLId) via update-distribution / console."
    ;;

  throttle-voice)
    API="${2:?usage: throttle-voice <apiId>  (e.g. abcd1234ef)}"
    aws apigatewayv2 update-stage --api-id "$API" --stage-name '$default' --region "$REGION" \
      --default-route-settings 'ThrottlingBurstLimit=10,ThrottlingRateLimit=5' >/dev/null
    echo "Voice API ${API} throttled to 5 rps / burst 10."
    ;;

  budget)
    AMT="${2:?usage: budget <amountUSD>}"
    EMAIL="${BUDGET_EMAIL:?Set BUDGET_EMAIL=you@example.com}"
    ACCT="$(aws sts get-caller-identity --query Account --output text)"
    cat > /tmp/budget.json <<JSON
{"BudgetName":"psiog-monthly","BudgetLimit":{"Amount":"${AMT}","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}
JSON
    cat > /tmp/notif.json <<JSON
[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80,"ThresholdType":"PERCENTAGE"},
  "Subscribers":[{"SubscriptionType":"EMAIL","Address":"${EMAIL}"}]}]
JSON
    aws budgets create-budget --account-id "$ACCT" \
      --budget file:///tmp/budget.json --notifications-with-subscribers file:///tmp/notif.json
    echo "Budget created: \$${AMT}/mo, alert at 80% to ${EMAIL}."
    ;;

  secrets)
    # Pull current API keys out of the Lambda env into Secrets Manager.
    FN="${FN:-psiog-transport-api}"
    KEYS="$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" \
      --query 'Environment.Variables.API_KEYS' --output text)"
    [ -z "$KEYS" ] || [ "$KEYS" = "None" ] && { echo "No API_KEYS env found on $FN"; exit 1; }
    ARN="$(aws secretsmanager create-secret --name psiog/api-keys --region "$REGION" \
      --secret-string "$KEYS" --query ARN --output text 2>/dev/null \
      || aws secretsmanager put-secret-value --secret-id psiog/api-keys --region "$REGION" \
           --secret-string "$KEYS" --query ARN --output text)"
    echo "Secret ARN: $ARN"
    echo "Next: grant the Lambda role secretsmanager:GetSecretValue on it and load API_KEYS"
    echo "from the secret at cold start (then remove the plaintext env var)."
    ;;

  *)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
