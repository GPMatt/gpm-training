#!/usr/bin/env bash
# Deploy the statement parser to Cloud Run.
#
# Run from this directory. parse_statement.py is copied in from the parent so
# the deployed parser is byte-identical to the one test_parser.py validates —
# there is deliberately no service-specific fork of the parsing logic.
set -euo pipefail

PROJECT="${GPM_PROJECT:?set GPM_PROJECT to your GCP project id}"
REGION="${GPM_REGION:-us-central1}"
SERVICE="${GPM_SERVICE:-gpm-statement-parser}"
SECRET="${GPM_PARSER_SECRET:?set GPM_PARSER_SECRET (see README step 4)}"

cp ../parse_statement.py .
trap 'rm -f parse_statement.py' EXIT

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --set-env-vars "GPM_PARSER_SECRET=$SECRET" \
  --memory 512Mi \
  --cpu 1 \
  --timeout 120 \
  --max-instances 3 \
  --min-instances 0

echo
echo "URL:"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format 'value(status.url)'
