from langchain_huggingface import HuggingFaceEmbeddings
from config.config import Config

class Embedding:
    def __init__(self, config: type[Config] = Config):
        self.embedding_model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

    def embed_documents(self, documents: list[str]) -> list[list[float]]:
        """
        Embed documents using a HuggingFace model and return the embeddings
        parameters:
            documents: List of document strings to be embedded
        """
        return self.embedding_model.embed_documents(documents)