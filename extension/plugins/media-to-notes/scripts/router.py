"""
链接类型路由
"""

from urllib.parse import urlparse


VIDEO_HOST_MARKERS = (
    "youtube.com",
    "youtu.be",
    "bilibili.com/video",
    "b23.tv",
    "tiktok.com",
    "douyin.com",
    "v.douyin.com",
    "instagram.com/reel",
    "instagram.com/p/",
)

GITHUB_HOST_MARKERS = (
    "github.com",
    "www.github.com",
)


def detect_link_type(url: str) -> str:
    """返回 article / video / github / unknown。"""
    normalized = url.lower().strip()
    parsed = urlparse(normalized)
    host = parsed.netloc
    path = parsed.path
    combined = f"{host}{path}"

    if any(marker in combined for marker in VIDEO_HOST_MARKERS):
        return "video"

    if any(marker == host for marker in GITHUB_HOST_MARKERS):
        return "github"

    return "article"


def detect_platform(url: str, content_type: str) -> str:
    """根据 URL 推断平台名。"""
    normalized = url.lower()

    platform_map = [
        ("mp.weixin.qq.com", "微信公众号"),
        ("zhuanlan.zhihu.com", "知乎"),
        ("zhihu.com", "知乎"),
        ("juejin.cn", "掘金"),
        ("medium.com", "Medium"),
        ("substack.com", "Substack"),
        ("youtube.com", "YouTube"),
        ("youtu.be", "YouTube"),
        ("bilibili.com", "Bilibili"),
        ("b23.tv", "Bilibili"),
        ("github.com", "GitHub"),
        ("tiktok.com", "TikTok"),
        ("douyin.com", "抖音"),
        ("instagram.com", "Instagram"),
    ]

    for marker, label in platform_map:
        if marker in normalized:
            return label

    if content_type == "video":
        return "视频平台"
    if content_type == "github":
        return "GitHub"
    return "网页"
