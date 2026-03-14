import os
from dotenv import load_dotenv

load_dotenv()

def _require_env(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise ValueError(f"Missing required environment variable: {key}")
    return value


class Config:
    BASE_URL = "https://docs.cloud.google.com"
    CATEGORY = "AI/ML"
    LOCALSTACK_URL = _require_env("LOCALSTACK_URL")
    RAW_BUCKET_NAME = _require_env("GCP_DOCS_BUCKET_NAME_RAW")
    PROCESSED_BUCKET_NAME = _require_env("GCP_DOCS_BUCKET_NAME_PROCESSED")
    AWS_ACCESS_KEY_ID = _require_env("AWS_ACCESS_KEY_ID")
    AWS_SECRET_ACCESS_KEY = _require_env("AWS_SECRET_ACCESS_KEY")
    AWS_DEFAULT_REGION = _require_env("AWS_DEFAULT_REGION")

    GCP_SERVICES = [

        # --- Main ---
        {"endpoint": "vertex-ai/docs?hl=en", "category": CATEGORY, "subcategory": "ML Platform", "product": "Vertex AI"},

        # --- Gen AI ---
        {"endpoint": "vertex-ai/generative-ai/docs?hl=en", "category": CATEGORY, "subcategory": "Generative AI", "product": "Vertex AI Generative AI"},
        {"endpoint": "gemini-api/docs?hl=en", "category": CATEGORY, "subcategory": "Generative AI", "product": "Gemini API"},

        # --- Agents e Conversation ---
        {"endpoint": "dialogflow/docs?hl=en", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Dialogflow CX"},
        {"endpoint": "dialogflow/es/docs?hl=en", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Dialogflow ES"},
        {"endpoint": "agent-builder/docs?hl=en", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Agent Builder"},
        {"endpoint": "agent-assist/docs?hl=en", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Agent Assist"},
        {"endpoint": "contact-center/docs?hl=en", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Contact Center AI"},

        # --- Visual Computing ---
        {"endpoint": "vision/docs?hl=en", "category": CATEGORY, "subcategory": "Vision", "product": "Cloud Vision API"},
        {"endpoint": "video-intelligence/docs?hl=en", "category": CATEGORY, "subcategory": "Vision", "product": "Video Intelligence API"},
        {"endpoint": "vertex-ai/docs/image-data?hl=en", "category": CATEGORY, "subcategory": "Vision", "product": "AutoML Vision"},
        {"endpoint": "vertex-ai-vision/docs?hl=en", "category": CATEGORY, "subcategory": "Vision", "product": "Vertex AI Vision"},

        # --- Natural Language ---
        {"endpoint": "natural-language/docs?hl=en", "category": CATEGORY, "subcategory": "Natural Language", "product": "Natural Language API"},
        {"endpoint": "translate/docs?hl=en", "category": CATEGORY, "subcategory": "Natural Language", "product": "Cloud Translation"},
        {"endpoint": "healthcare-api/docs?hl=en", "category": CATEGORY, "subcategory": "Natural Language", "product": "Healthcare Natural Language AI"},

        # --- Conversational ---
        {"endpoint": "speech-to-text/docs?hl=en", "category": CATEGORY, "subcategory": "Speech", "product": "Speech-to-Text"},
        {"endpoint": "text-to-speech/docs?hl=en", "category": CATEGORY, "subcategory": "Speech", "product": "Text-to-Speech"},

        # --- Documents ---
        {"endpoint": "document-ai/docs?hl=en", "category": CATEGORY, "subcategory": "Document AI", "product": "Document AI"},

        # --- ML Infrastructure ---
        {"endpoint": "tpu/docs?hl=en", "category": CATEGORY, "subcategory": "ML Infrastructure", "product": "Cloud TPU"},
        {"endpoint": "deep-learning-containers/docs?hl=en", "category": CATEGORY, "subcategory": "ML Infrastructure", "product": "Deep Learning Containers"},
        {"endpoint": "deep-learning-vm/docs?hl=en", "category": CATEGORY, "subcategory": "ML Infrastructure", "product": "Deep Learning VM"},

        # --- Data to ML ---
        {"endpoint": "timeseries-insights/docs?hl=en", "category": CATEGORY, "subcategory": "Data for ML", "product": "Timeseries Insights API"},
        {"endpoint": "recommendations-ai/docs?hl=en", "category": CATEGORY, "subcategory": "Data for ML", "product": "Recommendations AI"},
        {"endpoint": "retail/docs?hl=en", "category": CATEGORY, "subcategory": "Data for ML", "product": "Vertex AI Search for Retail"},
    ]