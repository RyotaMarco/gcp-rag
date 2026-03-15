from langchain_google_genai import GoogleGenerativeAIEmbeddings
from config.config import Config

class Embedding:
    def __init__(self, config: type[Config] = Config):
        self.gemini_api_key = config.GEMINI_API_KEY
        self.embedding_model = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-002", api_key=self.gemini_api_key)

    def embed_documents(self, documents: list[str]) -> list[list[float]]:
        """
        Embed documents using a Gemini model and return the embeddings
        parameters:
            documents: List of document strings to be embedded
        """
        return self.embedding_model.embed_documents(documents)


