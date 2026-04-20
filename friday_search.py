#!/usr/bin/env python3
"""
Friday 通用搜索客户端
接口：POST /tools/universal-search/api/v1
"""

import os
import requests
import json
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()


@dataclass
class FridaySearchParams:
    """Friday 通用搜索请求参数"""
    query: str
    sources: List[str] = field(default_factory=lambda: ["baidu-search-v2"])
    top_k: int = 10
    is_fast: bool = True
    timeout: int = 10
    ttl: int = 0  # <=0 不启用缓存
    fallback_engine: Optional[str] = None
    # bing 专用参数
    bing_start_date: Optional[str] = None
    bing_end_date: Optional[str] = None
    bing_sites: Optional[List[str]] = None
    # baidu-search-v2 专用参数
    baidu_recency_filter: Optional[str] = None  # week/month/semiyear/year


@dataclass
class FridaySearchResult:
    """单条搜索结果"""
    url: str = ""
    title: str = ""
    snippet: str = ""
    content: str = ""
    source: str = ""
    publish_time: str = ""


@dataclass
class FridaySearchResponse:
    """Friday 搜索响应"""
    status: int = 0
    message: str = ""
    code: int = 0
    msg: str = ""
    results: List[FridaySearchResult] = field(default_factory=list)
    internal_err_map: Dict[str, str] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)


class FridaySearchClient:
    """Friday 通用搜索 API 客户端"""

    def __init__(
        self,
        url: str = "http://agi.sankuai.com/tools/universal-search/api/v1",
        api_key: Optional[str] = None,
    ):
        self.url = url
        self.api_key = api_key or os.getenv("MT_LLM_API_KEY", "")

    def search(self, params: FridaySearchParams) -> FridaySearchResponse:
        """
        调用 Friday 通用搜索接口

        Args:
            params: 搜索参数

        Returns:
            FridaySearchResponse
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json;charset=UTF-8",
        }

        payload: Dict[str, Any] = {
            "query": params.query,
            "sources": params.sources,
            "topK": params.top_k,
            "isFast": params.is_fast,
            "timeout": params.timeout,
        }

        if params.ttl > 0:
            payload["ttl"] = params.ttl

        if params.fallback_engine:
            payload["fallbackEngine"] = params.fallback_engine

        # bing 专用参数
        bing_param = {}
        if params.bing_start_date:
            bing_param["startDate"] = params.bing_start_date
        if params.bing_end_date:
            bing_param["endDate"] = params.bing_end_date
        if params.bing_sites:
            bing_param["sites"] = params.bing_sites
        if bing_param:
            payload["bingSearchParam"] = bing_param

        # baidu-search-v2 专用参数
        if params.baidu_recency_filter:
            payload["baiduSearchV2Param"] = {
                "searchRecencyFilter": params.baidu_recency_filter,
            }

        try:
            response = requests.post(
                self.url,
                headers=headers,
                json=payload,
                timeout=params.timeout + 5,
            )
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.RequestException as e:
            return FridaySearchResponse(status=-1, message=str(e))

        resp = FridaySearchResponse(
            status=data.get("status", 0),
            message=data.get("message", ""),
            raw=data,
        )

        inner = data.get("data", {}) or {}
        resp.code = inner.get("code", 0)
        resp.msg = inner.get("msg", "")
        resp.internal_err_map = inner.get("internal_err_map", {})

        for item in inner.get("results", []) or []:
            resp.results.append(FridaySearchResult(
                url=item.get("url", ""),
                title=item.get("title", ""),
                snippet=item.get("snippet", ""),
                content=item.get("content", ""),
                source=item.get("source", ""),
                publish_time=item.get("publish_time", ""),
            ))

        return resp

    def quick_search(self, query: str, top_k: int = 10, sources: Optional[List[str]] = None) -> FridaySearchResponse:
        """便捷方法"""
        return self.search(FridaySearchParams(
            query=query,
            sources=sources or ["baidu-search-v2"],
            top_k=top_k,
        ))


def print_friday_result(resp: FridaySearchResponse):
    """格式化打印搜索结果"""
    print(f"状态: {resp.status}, 消息: {resp.message}")
    print(f"内部状态: code={resp.code}, msg={resp.msg}")
    if resp.internal_err_map:
        print(f"内部错误: {resp.internal_err_map}")
    print(f"共 {len(resp.results)} 条结果:\n")
    for i, r in enumerate(resp.results, 1):
        print(f"  {i}. {r.title}")
        print(f"     URL: {r.url}")
        print(f"     来源: {r.source}  发布时间: {r.publish_time}")
        content_preview = (r.content or r.snippet or "")[:200]
        print(f"     内容: {content_preview}")
        print()


if __name__ == "__main__":
    import sys

    query = sys.argv[1] if len(sys.argv) > 1 else "北京有什么好吃的"
    print(f"搜索: {query}")

    client = FridaySearchClient()
    resp = client.quick_search(query, top_k=5)
    print_friday_result(resp)
