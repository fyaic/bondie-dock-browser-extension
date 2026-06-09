"""
Obsidian 链接工具
"""

from pathlib import Path
from urllib.parse import quote


def build_obsidian_open_url(
    note_path: Path,
    vault_root: Path | None = None,
    vault_name: str | None = None,
) -> str:
    """生成可直接打开指定笔记的 Obsidian URL。"""
    resolved_note_path = note_path.expanduser().resolve()
    resolved_vault_root = _resolve_vault_root(resolved_note_path, vault_root)

    if resolved_vault_root:
        try:
            relative_path = resolved_note_path.relative_to(resolved_vault_root).as_posix()
            target_vault_name = vault_name or resolved_vault_root.name
            return (
                "obsidian://open"
                f"?vault={quote(target_vault_name, safe='')}"
                f"&file={quote(relative_path, safe='')}"
            )
        except ValueError:
            pass

    return f"obsidian://open?path={quote(resolved_note_path.as_posix(), safe='')}"


def build_relative_display_path(note_path: Path, vault_root: Path | None = None) -> str:
    """生成更适合展示的相对路径。"""
    if vault_root:
        try:
            return note_path.relative_to(vault_root).as_posix()
        except ValueError:
            pass
    return note_path.name


def _resolve_vault_root(note_path: Path, vault_root: Path | None) -> Path | None:
    if vault_root:
        return vault_root.expanduser().resolve()

    for parent in note_path.parents:
        if (parent / ".obsidian").exists():
            return parent

    return None
