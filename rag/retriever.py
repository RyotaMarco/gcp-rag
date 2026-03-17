from langchain_core.documents import Document
from qdrant_client import QdrantClient

from config.config import Config
from langchain_qdrant import QdrantVectorStore
from rag.embedding import Embedding

class Retriever:
    def __init__(self, config: type[Config] = Config):
        self.qdrant_url = config.QDRANT_URL
        self.embedding = Embedding()
        self.embedding_model = self.embedding.embedding_model
        self.qdrant_client = QdrantClient(self.qdrant_url)
        self.vector_store = QdrantVectorStore(
            client=self.qdrant_client,
            collection_name="embedded_files",
            embedding=self.embedding_model
        )


    def retrieve(self, query: str, top_k: int = 5) -> list[Document]:
        """
        Retrieve documents from the vector store based on the query.
        parameters:
            query: The query string.
            top_k: The number of top matching documents to retrieve.
        """
        return self.vector_store.similarity_search(query=query, k=top_k)

