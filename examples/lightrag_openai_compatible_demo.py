import os
import sys
import asyncio
import inspect
import logging
import logging.config
from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc, logger, set_verbose_debug
from lightrag.kg.shared_storage import initialize_pipeline_status

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"), override=True)
WORKING_DIR = "./dickens"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOG_DIR = PROJECT_ROOT / "log"


def configure_logging():
    """Configure logging for the application"""

    # Reset any existing handlers to ensure clean configuration
    for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error", "lightrag"]:
        logger_instance = logging.getLogger(logger_name)
        logger_instance.handlers = []
        logger_instance.filters = []

    # Get log directory path from environment variable or use current directory
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
            encoding="utf-8"
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
        llm_model_func=llm_model_func, # 大模型api
        embedding_func=EmbeddingFunc( # vector embedding api, 
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
            "language": "Chinese",  # 设置语言为中文
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

        # import json
        # with open("/Users/mac/Downloads/lightrag_inspire/lightrag/方剂.json", "r", encoding="utf-8") as f:
        #     json_data = json.load(f)
        # content = json.dumps(json_data, ensure_ascii=False)  
        # print("before insert", type(content))

        # await rag.ainsert(content, file_paths="/Users/mac/Downloads/lightrag_inspire/lightrag/方剂.json")
        # graph_tag = "standard_cure", file = data/cure_output.xlsx
        import pandas as pd
        def excel_to_strings(file_path, sheet_name=0):
            """
            读取Excel文件，将每一行转换为「表头名：内容」格式的字符串
            
            Args:
                file_path: Excel文件路径
                sheet_name: 工作表名称或索引，默认为0（第一个工作表）
            
            Returns:
                list: 每行转换后的字符串列表
            """
            # 读取Excel文件
            df = pd.read_excel(file_path, sheet_name=sheet_name)
            
            result_strings = ""
            
            # 遍历每一行
            for idx, row in df.iterrows():
                row_strings = ""
                
                # 遍历每一列（表头名）
                for col_name in df.columns:
                    value = row[col_name]
                    
                    # 处理空值
                    if pd.isna(value):
                        value_str = ""
                    else:
                        value_str = str(value).strip()
                    
                    # 拼接「表头名：内容」
                    row_strings = row_strings + f"{col_name}：{value_str}, "
                
                # 用\t连接当前行的所有字段
                result_strings = result_strings + row_strings + "\t"
            
            return result_strings
        #cure_entity_types = ["治法", "治疗阶段", "治疗目标", "治疗手段", "核心概念", "别名"]
        # llm 小模型，content，自动给出几个type, {relation_type}, must 
        cure_file = "/Users/mac/Downloads/lightrag_inspire/lightrag/方剂.json"
        #rag.addon_params["entity_types"] = cure_entity_types
        # 打开一个excel文件，读取所有sheet，每个sheet作为一个document插入

        #decease_entity_types = ["疾病", "症状", "病因", "病机", "病位", "证型", "证候", "别名"]
        decease_file = "/Users/mac/Downloads/lightrag_inspire/data/decease_output.xlsx"
        # #rag.addon_params["entity_types"] = decease_entity_types
        print("rag.addon_params: ", rag.addon_params)
        logger.info("rag.addon_params: ", rag.addon_params)
        # await rag.ainsert(content, file_paths=decease_file, graph_tag="default")
        # await rag.ainsert(content, file_paths=decease_file, graph_tag="standard_decease")

        # merge, graph_tag_list
        await rag.amerge_graph(graph_tags=["test1", "test2"])
        

        # Perform naive search
        # print("\n=====================")
        # print("Query mode: naive")
        # print("=====================")
        resp = 0
        # resp = await rag.aquery(
        #     "What are the top themes in this story?",
        #     param=QueryParam(mode="naive", stream=True),
        # )
        if inspect.isasyncgen(resp):
            await print_stream(resp)
        else:
            print(resp)

        # Perform local search
        # print("\n=====================")
        # print("Query mode: local")
        # print("=====================")
        # resp = await rag.aquery(
        #     "What are the top themes in this story?",
        #     param=QueryParam(mode="local", stream=True),
        # )
        if inspect.isasyncgen(resp):
            await print_stream(resp)
        else:
            print(resp)

        # Perform global search
        print("\n=====================")
        print("Query mode: global")
        print("=====================")
        # resp = await rag.aquery(
        #     "What are the top themes in this story?",
        #     param=QueryParam(mode="global", stream=True),
        # )
        if inspect.isasyncgen(resp):
            await print_stream(resp)
        else:
            print(resp)

        # Perform hybrid search
        print("\n=====================")
        print("Query mode: hybrid")
        print("=====================")
        # resp = await rag.aquery(
        #     "What are the top themes in this story?",
        #     param=QueryParam(mode="hybrid", stream=True),
        # )
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
