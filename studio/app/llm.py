"""Provider-agnostic LLM access.

The app was written against the Anthropic SDK. This adds a small adapter so the
exact same call sites (`client.messages.create(...)` / `.messages.stream(...)`)
also work against any OpenAI-compatible chat endpoint — notably Google Gemini's
free tier and Groq — without touching scriptgen/research/ideate/diagnose.

No extra dependencies: the adapter is a thin urllib POST to /chat/completions.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from types import SimpleNamespace

# A browser-style UA: some providers (Groq) sit behind Cloudflare, which blocks
# the default "Python-urllib" user-agent with a 403 "error code: 1010".
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")

# provider -> endpoint + a sensible free/default model + where to get a key
PROVIDERS = {
    "anthropic": {
        "base_url": "", "model": "claude-opus-4-8",
        "label": "Claude (Anthropic) — paid",
        "key_url": "https://console.anthropic.com/settings/keys",
        "key_hint": "starts with sk-ant-"},
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-2.0-flash",
        "label": "Google Gemini — free",
        "key_url": "https://aistudio.google.com/apikey",
        "key_hint": "starts with AIza — free, no credit card"},
    "groq": {
        "base_url": "https://api.groq.com/openai/v1/",
        "model": "llama-3.3-70b-versatile",
        "label": "Groq (Llama) — free",
        "key_url": "https://console.groq.com/keys",
        "key_hint": "starts with gsk_ — free"},
}


def _extract_json(text: str):
    """Best-effort parse of a JSON value the model returned (tolerates code
    fences and surrounding prose)."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[A-Za-z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    for a, b in (("{", "}"), ("[", "]")):
        i, j = t.find(a), t.rfind(b)
        if 0 <= i < j:
            try:
                return json.loads(t[i:j + 1])
            except Exception:
                continue
    return None


class _Message:
    def __init__(self, text: str, parsed=None, stop_reason: str = "end_turn"):
        self.content = [SimpleNamespace(type="text", text=text)]
        self.parsed_output = parsed
        self.stop_reason = stop_reason


class _Stream:
    def __init__(self, message: _Message):
        self._message = message

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self._message


class OpenAICompatClient:
    """Mimics the slice of anthropic.Anthropic the app uses, over a chat endpoint."""

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key or ""
        self.model = model
        self.messages = _Messages(self)

    def _complete(self, kwargs: dict) -> _Message:
        system = kwargs.get("system") or ""
        oc = kwargs.get("output_config") or {}
        schema = (oc.get("format") or {}).get("schema") if oc else None
        want_json = schema is not None
        if want_json:
            system = (system + "\n\nReturn ONLY one valid JSON value matching this "
                      "JSON schema — no prose, no markdown fences:\n" + json.dumps(schema))

        chat = []
        if system:
            chat.append({"role": "system", "content": system})
        for m in kwargs.get("messages", []):
            content = m.get("content")
            if isinstance(content, list):
                content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
            chat.append({"role": m.get("role", "user"), "content": content or ""})

        body = {"model": kwargs.get("model") or self.model, "messages": chat}
        # cap to a value every common free model accepts (Gemini Flash = 8192);
        # our outputs (scripts, idea lists, reports) are far smaller than this
        req_max = int(kwargs.get("max_tokens") or 4096)
        body["max_tokens"] = min(req_max, 8192)

        if want_json:
            body["response_format"] = {"type": "json_object"}
            resp = self._post(body, allow_retry=True)   # may return None on a 400
            if resp is None:                             # provider rejected response_format
                body.pop("response_format", None)
                resp = self._post(body)                  # retry plainly; raises on error
        else:
            resp = self._post(body)                      # raises on error

        text = ((resp.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        parsed = _extract_json(text) if want_json else None
        return _Message(text, parsed=parsed)

    def _post(self, body: dict, allow_retry: bool = False):
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self.api_key}",
                     "Content-Type": "application/json", "User-Agent": _UA},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")
            try:  # surface the human-readable reason (providers use {..} or [{..}])
                j = json.loads(detail)
                if isinstance(j, list):
                    j = j[0]
                detail = j.get("error", {}).get("message", detail)
            except Exception:
                pass
            if e.code == 400 and allow_retry:
                return None  # caller will retry without response_format
            raise RuntimeError(f"AI error {e.code}: {detail[:300]}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Could not reach the AI provider: {e.reason}")


class _Messages:
    def __init__(self, client: OpenAICompatClient):
        self._client = client

    def create(self, **kwargs) -> _Message:
        return self._client._complete(kwargs)

    def stream(self, **kwargs) -> _Stream:
        # the app only needs the final message; do the call now, wrap it as a stream
        return _Stream(self._client._complete(kwargs))


def test_connection(cfg) -> tuple[bool, str]:
    """Make one tiny real call to verify the provider + key work. Returns
    (ok, human message). Never raises."""
    provider = getattr(cfg, "provider", "anthropic") or "anthropic"
    label = PROVIDERS.get(provider, {}).get("label", provider)
    if not (cfg.anthropic_api_key or "").strip():
        return False, "No API key set. Paste your key and save."
    try:
        client = make_client(cfg)
        resp = client.messages.create(
            model=cfg.model, max_tokens=16,
            messages=[{"role": "user", "content": "Reply with just: OK"}])
        text = "".join(getattr(b, "text", "") for b in resp.content).strip()
        return True, f"Connected — {label} is working (model {cfg.model})."
    except Exception as e:
        return False, str(e)[:400]


def make_client(cfg):
    """Return the right client for cfg.provider. Anthropic uses its SDK; every
    other provider goes through the OpenAI-compatible adapter."""
    provider = getattr(cfg, "provider", "anthropic") or "anthropic"
    if provider == "anthropic":
        import anthropic
        return anthropic.Anthropic(api_key=cfg.anthropic_api_key or None)
    preset = PROVIDERS.get(provider, {})
    base = getattr(cfg, "llm_base_url", "") or preset.get("base_url", "")
    model = cfg.model or preset.get("model", "")
    return OpenAICompatClient(base, cfg.anthropic_api_key, model)
