#!/bin/bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch GOOGLE_OAUTH_SETUP.md" \
  --prune-empty --tag-name-filter cat -- --all
