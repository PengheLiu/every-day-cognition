#!/usr/bin/env python3
"""
网页爬取与解析客户端（参考实现）

从 CRAWL_API_URL 环境变量读取后端地址；账号密码通过 CRAWL_API_USERNAME /
CRAWL_API_PASSWORD 传入。仅供批量调试 / 离线实验使用，web 端不依赖本文件。
"""

import os
import requests
import json
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()


@dataclass
class CrawlAndParseParams:
    """爬取解析请求参数"""
    urls: List[str]
    timeout_in_ms: int = 30000
    no_proxy: bool = False


@dataclass
class CrawlResult:
    """单个 URL 的爬取解析结果"""
    url: str = ""
    title: str = ""
    text: str = ""
    error_status: Optional[str] = None
    err_msg: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CrawlAndParseResponse:
    """爬取解析响应"""
    code: int = 0
    msg: Optional[str] = None
    results: List[CrawlResult] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)


class CrawlAndParseClient:
    """网页爬取与解析 API 客户端"""

    def __init__(
        self,
        url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.url = url or os.getenv("CRAWL_API_URL", "")
        self.auth = (
            username or os.getenv("CRAWL_API_USERNAME", ""),
            password or os.getenv("CRAWL_API_PASSWORD", ""),
        )

    def crawl(self, params: CrawlAndParseParams) -> CrawlAndParseResponse:
        """
        爬取并解析指定 URL 列表

        Args:
            params: 爬取参数

        Returns:
            CrawlAndParseResponse
        """
        payload = {
            "urls": params.urls,
            "timeout_in_ms": params.timeout_in_ms,
            "noProxy": params.no_proxy,
        }

        if not self.url:
            return CrawlAndParseResponse(code=500, msg="CRAWL_API_URL not configured")

        try:
            response = requests.post(
                self.url,
                auth=self.auth,
                json=payload,
                timeout=params.timeout_in_ms / 1000 + 5,
            )
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.RequestException as e:
            return CrawlAndParseResponse(code=500, msg=str(e))

        resp = CrawlAndParseResponse(
            code=data.get("code", 0),
            msg=data.get("msg"),
            raw=data,
        )

        for item in data.get("data", []) or []:
            resp.results.append(CrawlResult(
                url=item.get("url", ""),
                title=item.get("title", ""),
                text=item.get("text", ""),
                error_status=item.get("error_status"),
                err_msg=item.get("err_msg"),
                extra=item.get("extra", {}),
            ))

        return resp

    def crawl_urls(self, urls: List[str], timeout_ms: int = 30000) -> CrawlAndParseResponse:
        """便捷方法：直接传 URL 列表"""
        return self.crawl(CrawlAndParseParams(urls=urls, timeout_in_ms=timeout_ms))


def print_crawl_result(resp: CrawlAndParseResponse):
    """格式化打印爬取结果"""
    print(f"状态码: {resp.code}, 消息: {resp.msg}")
    print(f"共 {len(resp.results)} 个结果:\n")
    for i, r in enumerate(resp.results, 1):
        print(f"  {i}. {r.url}")
        if r.error_status:
            print(f"     ERROR: {r.error_status} - {r.err_msg}")
        else:
            print(f"     标题: {r.title}")
            text_preview = r.text[:200] if r.text else "(空)"
            print(f"     正文: {text_preview}")
            if r.extra:
                duration = r.extra.get("crawl_duration", "?")
                parser = r.extra.get("selected_parser", "?")
                print(f"     耗时: {duration}ms, 解析器: {parser}")
        print()


if __name__ == "__main__":
    import sys

    urls = sys.argv[1:] if len(sys.argv) > 1 else ["https://arxiv.org/abs/2503.20215"]
    print(f"爬取 {len(urls)} 个 URL...")

    client = CrawlAndParseClient()
    resp = client.crawl_urls(urls, timeout_ms=20000)
    print_crawl_result(resp)
