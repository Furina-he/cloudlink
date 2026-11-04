# Discovery/version only. Identity and scope run through the bounded Node/Python bridges.
cl_emit() { printf '\n__CLOUDLINK_CLI_METADATA__\n%s\n' "$1"; }
case "$cl_provider" in
  cloudflare) cl_name=wrangler ;;
  vercel) cl_name=vercel ;;
  oracle) cl_name=oci ;;
  *) cl_emit '{"error":"cli-command-unsupported"}'; exit 1 ;;
esac
if [ "$cl_operation" = discover ]; then
  cl_found=$(type -P "$cl_name" 2>/dev/null || true)
  if [ -z "$cl_found" ]; then cl_emit '{"installed":false}'; exit 0; fi
  cl_escaped=${cl_found//\\/\\\\}
  cl_escaped=${cl_escaped//\"/\\\"}
  cl_emit "{\"installed\":true,\"path\":\"$cl_escaped\"}"
  exit 0
fi
if [ "$cl_operation" = version ]; then
  cl_text=$("$cl_binary" --version 2>/dev/null)
  cl_version=$(printf '%s' "$cl_text" | grep -Eo '[0-9]+\.[0-9]+(\.[0-9]+){0,2}' | head -n 1)
  cl_emit "{\"version\":\"$cl_version\"}"
  exit 0
fi
cl_emit '{"error":"cli-command-unsupported"}'
exit 1
