from langchain_core.tools import tool
from pydantic import BaseModel, Field
from tavily import AsyncTavilyClient
from typing import List, Optional, Dict
from copilotkit.langchain import copilotkit_emit_state
from langchain_core.runnables import RunnableConfig

tavily_client = AsyncTavilyClient()


class TavilyExtractInput(BaseModel):
    urls: List[str] = Field(description="List of a single or several URLs for extracting raw content to gather additional information")
    state: Optional[Dict] = Field(description="State of the research")


async def _log_extract_status(state, message):
    """Append an extraction status entry to the logs and emit the state."""
    config = RunnableConfig()
    state["logs"] = state.get("logs", [])
    state["logs"].append({
        "message": message,
        "done": True
    })
    await copilotkit_emit_state(config, state)


@tool("tavily_extract", args_schema=TavilyExtractInput, return_direct=True)
async def tavily_extract(urls, state):
    """Perform full scrape to a provided list of urls."""

    state["sources"] = state.get("sources", {})

    try:
        response = await tavily_client.extract(urls=urls)
        results = (response or {}).get('results') or []
        failed_results = (response or {}).get('failed_results') or []

        if not results:
            # Nothing came back — record it in the logs and tell the caller
            # explicitly instead of silently returning an empty string.
            await _log_extract_status(
                state,
                f"⚠️ Extraction returned no content for {len(urls)} URL(s): "
                + ", ".join(urls)
            )
            return state, (
                "tavily_extract could not retrieve any raw content for the requested "
                f"URLs: {', '.join(urls)}. No content was extracted; these sources "
                "remain without raw_content."
            )

        # Match and add raw_content to urls in state
        tool_msg = "Extracted raw content to gather additional information from the following sources:\n"
        for itm in results:
            url = itm['url']
            raw_content = itm['raw_content']
            if url in state["sources"]:
                state["sources"][url]['raw_content'] = raw_content
            else:
                state["sources"][url] = {'url': url, 'raw_content': raw_content}
            tool_msg += f"{url}\n"

        if failed_results:
            failed_urls = [f.get('url', 'unknown') if isinstance(f, dict) else str(f) for f in failed_results]
            tool_msg += (
                "Failed to extract content from the following URLs: "
                + ", ".join(failed_urls) + "\n"
            )
            await _log_extract_status(
                state,
                "⚠️ Extraction failed for some sources: " + ", ".join(failed_urls)
            )

        await _log_extract_status(state, "🚀 Extracting additional content from valuable sources")
        return state, tool_msg

    except Exception as e:
        print(f"Error occurred during extract: {str(e)}")
        # Surface the failure in the logs and in the tool response so neither
        # the UI nor the model is left thinking content was retrieved.
        await _log_extract_status(
            state,
            f"⚠️ Failed to extract additional content from {len(urls)} URL(s): {e}"
        )
        return state, (
            f"tavily_extract failed to retrieve raw content for the requested "
            f"URLs ({', '.join(urls)}): {e}. No content was extracted."
        )
