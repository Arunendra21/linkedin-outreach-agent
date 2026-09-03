"""Config loading with light validation and password-file resolution."""
from __future__ import annotations

import os
from pathlib import Path

import yaml


class Config:
    def __init__(self, data: dict):
        self._d = data

    @classmethod
    def load(cls, path: str | Path) -> "Config":
        path = Path(path).expanduser()
        if not path.exists():
            raise FileNotFoundError(
                f"Config not found: {path}\n"
                "Copy config.example.yaml -> config.yaml and edit it."
            )
        with open(path) as fh:
            data = yaml.safe_load(fh) or {}
        return cls(data)

    def __getitem__(self, key):
        return self._d[key]

    def get(self, *keys, default=None):
        """Nested get: cfg.get('limits', 'dry_run', default=False)."""
        node = self._d
        for k in keys:
            if not isinstance(node, dict) or k not in node:
                return default
            node = node[k]
        return node

    # ── derived helpers ──────────────────────────────────────
    def smtp_password(self) -> str:
        pw_file = self.get("smtp", "password_file")
        if not pw_file:
            raise ValueError("smtp.password_file not set in config")
        pw = Path(pw_file).expanduser().read_text().strip()
        if not pw:
            raise ValueError(f"Password file is empty: {pw_file}")
        return pw

    def dry_run(self) -> bool:
        return bool(self.get("limits", "dry_run", default=False))
