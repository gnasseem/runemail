#!/bin/bash
# Run this to deploy/redeploy edge functions with correct settings
# Requires: npx supabase login first (or SUPABASE_ACCESS_TOKEN env var)

PROJECT_REF="qamzysoysmqzulordfzy"

echo "Deploying api function (no-verify-jwt for tracking pixel)..."
npx supabase functions deploy api --no-verify-jwt --project-ref $PROJECT_REF

echo "Deploying scheduled-emails function..."
npx supabase functions deploy scheduled-emails --project-ref $PROJECT_REF

echo "Done."
