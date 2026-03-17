from langchain_core.documents import Document
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

from config.config import Config
from langchain_qdrant import QdrantVectorStore
from rag.embedding import Embedding

class Indexer:
    def __init__(self, config: type[Config] = Config):
        self.qdrant_url = config.QDRANT_URL
        self.embedding = Embedding()
        self.embedding_model = self.embedding.embedding_model
        self.qdrant_client = QdrantClient(self.qdrant_url)
        self._create_collection()

    def _create_collection(self) -> None:
        """
        Create Qdrant collection for embedding files
        """
        if not self.qdrant_client.collection_exists("embedded_files"):
            self.qdrant_client.create_collection(
                collection_name="embedded_files",
                vectors_config=VectorParams(size=384, distance=Distance.COSINE))

    def add_documents(self, documents: list[Document]) -> QdrantVectorStore:
        """
        Access Qdrant Vector Store to add documents
        parameters:
            documents: List of documents to be added
        """
        vector_store = QdrantVectorStore(
            client=self.qdrant_client,
            collection_name="embedded_files",
            embedding=self.embedding_model
        )
        vector_store.add_documents(documents=documents)
        return vector_store