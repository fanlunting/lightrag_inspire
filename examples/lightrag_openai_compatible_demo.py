import os
import sys
import asyncio
import inspect
import logging
import logging.config
from pathlib import Path
from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc, logger, set_verbose_debug
from lightrag.kg.shared_storage import initialize_pipeline_status

from dotenv import load_dotenv

load_dotenv(
    dotenv_path=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
    override=True,
)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOG_DIR = PROJECT_ROOT / "log"
WORKING_DIR = "./dickens"


def configure_logging():
    """Configure logging for the application"""

    # Reset any existing handlers to ensure clean configuration
    for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error", "lightrag"]:
        logger_instance = logging.getLogger(logger_name)
        logger_instance.handlers = []
        logger_instance.filters = []

    # Use absolute log directory alongside repo root folders (lightrag/examples/log)
    log_dir = Path(os.getenv("LOG_DIR", DEFAULT_LOG_DIR)).resolve()
    log_file_path = log_dir / "lightrag_compatible_demo.log"

    print(f"\nLightRAG compatible demo log file: {log_file_path}\n")
    log_dir.mkdir(parents=True, exist_ok=True)

    # Get log file max size and backup count from environment variables
    log_max_bytes = int(os.getenv("LOG_MAX_BYTES", 10485760))  # Default 10MB
    log_backup_count = int(os.getenv("LOG_BACKUP_COUNT", 5))  # Default 5 backups

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": "%(levelname)s: %(message)s",
                },
                "detailed": {
                    "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                },
            },
            "handlers": {
                "console": {
                    "formatter": "default",
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stderr",
                },
                "file": {
                    "formatter": "detailed",
                    "class": "logging.handlers.RotatingFileHandler",
                    "filename": str(log_file_path),
                    "maxBytes": log_max_bytes,
                    "backupCount": log_backup_count,
                    "encoding": "utf-8",
                },
            },
            "loggers": {
                "lightrag": {
                    "handlers": ["console", "file"],
                    "level": "INFO",
                    "propagate": False,
                },
            },
        }
    )

    # Ensure logger has handlers after dictConfig
    # Sometimes dictConfig doesn't properly attach handlers, so we verify and add if needed
    # The logger imported from lightrag.utils is the same instance as logging.getLogger("lightrag")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    
    # Check if handlers exist, if not create them
    has_console = any(isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler) 
                      and not isinstance(h, logging.handlers.RotatingFileHandler) 
                      for h in logger.handlers)
    has_file = any(isinstance(h, logging.handlers.RotatingFileHandler) for h in logger.handlers)
    
    if not has_console:
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
        console_handler.setLevel(logging.INFO)
        logger.addHandler(console_handler)
        print(f"Added console handler to logger. Total handlers: {len(logger.handlers)}")
    
    if not has_file:
        file_handler = logging.handlers.RotatingFileHandler(
            log_file_path,
            maxBytes=log_max_bytes,
            backupCount=log_backup_count,
            encoding="utf-8",
        )
        file_handler.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
        file_handler.setLevel(logging.INFO)
        logger.addHandler(file_handler)
        print(f"Added file handler to logger. Total handlers: {len(logger.handlers)}")
    
    # Verify logger configuration
    print(f"Logger level: {logger.level}, Effective level: {logger.getEffectiveLevel()}")
    print(f"Logger handlers count: {len(logger.handlers)}")
    for i, handler in enumerate(logger.handlers):
        print(f"  Handler {i}: {type(handler).__name__}, level: {handler.level}")
    
    # Enable verbose debug if needed
    set_verbose_debug(os.getenv("VERBOSE_DEBUG", "false").lower() == "true")


if not os.path.exists(WORKING_DIR):
    os.mkdir(WORKING_DIR)


async def llm_model_func(
    prompt, system_prompt=None, history_messages=[], keyword_extraction=False, **kwargs
) -> str:
    return await openai_complete_if_cache(
        os.getenv("LLM_MODEL", "deepseek-chat"),
        prompt,
        system_prompt=system_prompt,
        history_messages=history_messages,
        api_key=os.getenv("LLM_BINDING_API_KEY", "sk-db442f07feb340bcba320c7be940a034"),
        base_url=os.getenv("LLM_BINDING_HOST", "https://api.deepseek.com"),
        **kwargs,
    )


async def print_stream(stream):
    async for chunk in stream:
        if chunk:
            print(chunk, end="", flush=True)


async def initialize_rag():
    custom_entity_types = [
        "方剂",
        "方剂别名",
        "方剂功用",
        "主治病症",
        "出处典籍",
        "症状",
        "证型",
    ]

    rag = LightRAG(
        working_dir=WORKING_DIR,
        llm_model_func=llm_model_func,
        embedding_func=EmbeddingFunc(
            embedding_dim=int(os.getenv("EMBEDDING_DIM", "1024")),
            max_token_size=int(os.getenv("MAX_EMBED_TOKENS", "8192")),
            func=lambda texts: openai_embed(
                texts,
                model=os.getenv("EMBEDDING_MODEL", "BAAI/bge-large-zh-v1.5"),
                base_url=os.getenv("EMBEDDING_BINDING_HOST", "https://api.siliconflow.cn/v1"),
                api_key=os.getenv("EMBEDDING_BINDING_API_KEY", "sk-ojwiwjclbocrgccaspwdoxymwlcgbkrtefthwpqgpdgdqyby"),
            ),
        ),
        addon_params={
            "language": os.getenv("SUMMARY_LANGUAGE", "Chinese"),  # 设置语言为中文
            "entity_types": custom_entity_types,  # 传入自定义的 entity_types
        },
        graph_storage="Neo4JStorage",
    )

    await rag.initialize_storages()
    await initialize_pipeline_status()

    return rag


async def main():
    try:
        # Clear old data files
        files_to_delete = [
            "graph_chunk_entity_relation.graphml",
            "kv_store_doc_status.json",
            "kv_store_full_docs.json",
            "kv_store_text_chunks.json",
            "vdb_chunks.json",
            "vdb_entities.json",
            "vdb_relationships.json",
        ]

        for file in files_to_delete:
            file_path = os.path.join(WORKING_DIR, file)
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Deleting old file:: {file_path}")

        # Initialize RAG instance
        rag = await initialize_rag()
        print("api_key: "+ os.getenv("LLM_BINDING_API_KEY"))
        # 打印 graph_storage 的类型
        print("graph_storage: " + rag.graph_storage)

        # Test embedding function
        test_text = ["This is a test string for embedding."]
        embedding = await rag.embedding_func(test_text)
        embedding_dim = embedding.shape[1]
        print("\n=======================")
        print("Test embedding function")
        print("========================")
        print(f"Test dict: {test_text}")
        print(f"Detected embedding dimension: {embedding_dim}\n\n")

        import json
        with open("/Users/mac/Downloads/lightrag_inspire/lightrag/方剂.json", "r", encoding="utf-8") as f:
            json_data = json.load(f)
        content = json.dumps(json_data, ensure_ascii=False)  
        print("before insert", type(content))

        await rag.ainsert(content, file_paths="/Users/mac/Downloads/lightrag_inspire/lightrag/方剂.json")
        print("after insert")
        # Perform naive search
        print("\n=====================")
        print("Query mode: naive")
        print("=====================")
        resp = await rag.aquery(
            "What are the top themes in this story?",
            param=QueryParam(mode="naive", stream=True),
        )
        if inspect.isasyncgen(resp):
            await print_stream(resp)
        else:
            print(resp)

        # Perform local search
        print("\n=====================")
        print("Query mode: local")
        print("=====================")
        resp = await rag.aquery(
            "What are the top themes in this story?",
            param=QueryParam(mode="local", stream=True),
        )
        if inspect.isasyncgen(resp):
            await print_stream(resp)
        else:
            print(resp)

        # Perform global search
        print("\n=====================")
        print("Query mode: global")
        print("=====================")
        resp = await rag.aquery(
            "What are the top themes in this story?",
            param=QueryParam(mode="global", stream=True),
        )
        if inspect.isasyncgen(resp):
            await print_stream(resp)
        else:
            print(resp)

        # Perform hybrid search
        print("\n=====================")
        print("Query mode: hybrid")
        print("=====================")
        resp = await rag.aquery(
            "What are the top themes in this story?",
            param=QueryParam(mode="hybrid", stream=True),
        )
        if inspect.isasyncgen(resp):
            await print_stream(resp)
        else:
            print(resp)

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if rag:
            await rag.finalize_storages()


if __name__ == "__main__":
    # Configure logging before running the main function
    configure_logging()
    asyncio.run(main())
    print("\nDone!")
