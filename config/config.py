class Config:
    BASE_URL = "https://cloud.google.com"
    CATEGORY = "AI/ML"

    GCP_SERVICES = [

        # --- Main ---
        {"endpoint": "/vertex-ai/docs", "category": CATEGORY, "subcategory": "ML Platform", "product": "Vertex AI"},
        {"endpoint": "vertex-ai/docs/workbench/introduction", "category": CATEGORY, "subcategory": "ML Platform", "product": "Vertex AI Workbench"},
        {"endpoint": "vertex-ai/docs/colab/introduction", "category": CATEGORY, "subcategory": "ML Platform", "product": "Colab Enterprise"},
        {"endpoint": "vertex-ai/docs/pipelines/introduction", "category": CATEGORY, "subcategory": "ML Platform", "product": "Vertex AI Pipelines"},
        {"endpoint": "vertex-ai/docs/model-registry/introduction", "category": CATEGORY, "subcategory": "ML Platform", "product": "Vertex AI Model Registry"},
        {"endpoint": "vertex-ai/docs/evaluation/introduction", "category": CATEGORY, "subcategory": "ML Platform", "product": "Vertex AI Evaluation"},
        {"endpoint": "vertex-ai/docs/feature-store/overview", "category": CATEGORY, "subcategory": "ML Platform", "product": "Vertex AI Feature Store"},

        # # --- Gen AI ---
        {"endpoint": "vertex-ai/generative-ai/docs/overview", "category": CATEGORY, "subcategory": "Generative AI", "product": "Vertex AI Generative AI"},
        {"endpoint": "vertex-ai/generative-ai/docs/model-garden/explore-models", "category": CATEGORY, "subcategory": "Generative AI", "product": "Model Garden"},
        {"endpoint": "vertex-ai/generative-ai/docs/imagen/overview", "category": CATEGORY, "subcategory": "Generative AI", "product": "Imagen"},
        {"endpoint": "vertex-ai/generative-ai/docs/embeddings/get-text-embeddings", "category": CATEGORY, "subcategory": "Generative AI", "product": "Text Embeddings"},
        {"endpoint": "gemini-api/docs/overview", "category": CATEGORY, "subcategory": "Generative AI", "product": "Gemini API"},

        # --- Agents e Conversation ---
        {"endpoint": "dialogflow/docs/overview", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Dialogflow CX"},
        {"endpoint": "dialogflow/es/docs/basics", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Dialogflow ES"},
        {"endpoint": "agent-builder/docs/overview", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Agent Builder"},
        {"endpoint": "agent-assist/docs/overview", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Agent Assist"},
        {"endpoint": "contact-center/docs/overview", "category": CATEGORY, "subcategory": "Conversational AI", "product": "Contact Center AI"},

        # --- Visual Computing ---
        {"endpoint": "vision/docs/introduction", "category": CATEGORY, "subcategory": "Vision", "product": "Cloud Vision API"},
        {"endpoint": "video-intelligence/docs/basics", "category": CATEGORY, "subcategory": "Vision", "product": "Video Intelligence API"},
        {"endpoint": "vertex-ai/docs/image-data/overview", "category": CATEGORY, "subcategory": "Vision", "product": "AutoML Vision"},
        {"endpoint": "vertex-ai-vision/docs/overview", "category": CATEGORY, "subcategory": "Vision", "product": "Vertex AI Vision"},

        # --- Natural Language ---
        {"endpoint": "natural-language/docs/basics", "category": CATEGORY, "subcategory": "Natural Language", "product": "Natural Language API"},
        {"endpoint": "translate/docs/overview", "category": CATEGORY, "subcategory": "Natural Language", "product": "Cloud Translation"},
        {"endpoint": "healthcare-api/docs/nlp", "category": CATEGORY, "subcategory": "Natural Language", "product": "Healthcare Natural Language AI"},

        # --- Conversational ---
        {"endpoint": "speech-to-text/docs/basics", "category": CATEGORY, "subcategory": "Speech", "product": "Speech-to-Text"},
        {"endpoint": "text-to-speech/docs/basics", "category": CATEGORY, "subcategory": "Speech", "product": "Text-to-Speech"},

        # --- Documents ---
        {"endpoint": "document-ai/docs/overview", "category": CATEGORY, "subcategory": "Document AI", "product": "Document AI"},
        {"endpoint": "document-ai/docs/workbench/overview", "category": CATEGORY, "subcategory": "Document AI", "product": "Document AI Workbench"},

        # --- ML Infrastructure ---
        {"endpoint": "tpu/docs/intro-to-tpu", "category": CATEGORY, "subcategory": "ML Infrastructure", "product": "Cloud TPU"},
        {"endpoint": "deep-learning-containers/docs/overview", "category": CATEGORY, "subcategory": "ML Infrastructure", "product": "Deep Learning Containers"},
        {"endpoint": "deep-learning-vm/docs/introduction", "category": CATEGORY, "subcategory": "ML Infrastructure", "product": "Deep Learning VM"},

        # --- Data to ML ---
        {"endpoint": "timeseries-insights/docs/overview", "category": CATEGORY, "subcategory": "Data for ML", "product": "Timeseries Insights API"},
        {"endpoint": "recommendations-ai/docs/overview", "category": CATEGORY, "subcategory": "Data for ML", "product": "Recommendations AI"},
        {"endpoint": "retail/docs/overview", "category": CATEGORY, "subcategory": "Data for ML", "product": "Vertex AI Search for Retail"},

    ]