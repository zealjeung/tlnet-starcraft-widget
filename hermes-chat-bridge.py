#!/usr/bin/env python3
"""Elinchat widget -> Hermes agent bridge.

Reads one or more JSON lines on stdin, writes one JSON line per message on stdout.
Accepted payload shapes (the renderer double-encodes, so both must work):

    {"message": "hi"}
    {"message": "hi", "system": "You are an Elin game expert..."}
    {"message": "{\"message\": \"hi\", \"system\": \"...\"}"}
"""
import sys
import json
import os
from pathlib import Path


def hermes_home() -> Path:
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env)
    return Path.home() / ".hermes"


def load_config(home: Path) -> dict:
    try:
        import yaml
        cfg = home / "config.yaml"
        if cfg.exists():
            return yaml.safe_load(cfg.read_text(encoding="utf-8")) or {}
    except Exception:
        pass
    return {}


def unwrap(payload: dict):
    """Return (message, system). Handles the renderer's double-encoded payload."""
    msg = payload.get("message", "")
    system = payload.get("system")
    if isinstance(msg, str):
        s = msg.strip()
        if s.startswith("{") and s.endswith("}"):
            try:
                inner = json.loads(s)
                if isinstance(inner, dict) and inner.get("message"):
                    return inner.get("message", ""), inner.get("system") or system
            except Exception:
                pass
    return msg, system


home = hermes_home()
agent_root = home / "hermes-agent"
sys.path.insert(0, str(agent_root))
os.chdir(agent_root)

try:
    from run_agent import AIAgent

    config = load_config(home)
    mc = config.get("model") or {}
    if isinstance(mc, str):
        mc = {}
    resolved_model = mc.get("default") or mc.get("model") or mc.get("chat_model") or None
    resolved_provider = mc.get("provider") or None
    resolved_base_url = mc.get("base_url") or None
    resolved_api_key = mc.get("api_key") or None

    # Force LongCat free model — do NOT use OpenRouter or any paid provider
    resolved_provider = "nous"
    resolved_model = "meituan/longcat-2.5-preview:free"
    resolved_base_url = None
    resolved_api_key = None

    agent = AIAgent(
        provider=resolved_provider,
        model=resolved_model,
        api_key=resolved_api_key,
        base_url=resolved_base_url,
        api_mode=mc.get("api_mode", "chat_completions"),
        max_iterations=1,
        platform="desktop",
        session_id="tlnetchat-bridge",
        quiet_mode=True,
        enabled_toolsets=[],
        skip_context_files=True,
        skip_memory=True,
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            message, system = unwrap(payload)
            if not message:
                continue
            if system:
                system_final = (
                    system
                    + "\n\nYou have no tools available in this session. Answer directly in plain text "
                    "from the wiki context above and your own knowledge — never emit tool-call markup."
                )
                result = agent.run_conversation(message, system_message=system_final)
                response = result.get("final_response") or ""
            else:
                response = agent.chat(message)
            print(json.dumps({"response": response}))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()
except Exception as e:
    print(json.dumps({"error": "bridge_init_failed: " + str(e)}))
    sys.stdout.flush()
