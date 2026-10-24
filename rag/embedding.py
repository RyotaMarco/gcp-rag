"""Local multilingual embeddings and relevance scoring; loaded only when needed."""
from threading import RLock
from config.config import Settings, get_settings


class Embedding:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.model_name = self.settings.embedding_model
        self._model = None
        self._lock = RLock()

    @property
    def model(self):
        with self._lock:
            if self._model is None:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(self.model_name, device="cpu")
            return self._model

    @property
    def dimension(self) -> int:
        return int(self.model.get_sentence_embedding_dimension())

    def embed_documents(self, documents: list[str]) -> list[list[float]]:
        return self.model.encode(["passage: " + item for item in documents],
                                 normalize_embeddings=True, batch_size=32,
                                 show_progress_bar=False).tolist()

    def embed_query(self, query: str) -> list[float]:
        return self.model.encode("query: " + query, normalize_embeddings=True,
                                 show_progress_bar=False).tolist()


class Reranker:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._model = None
        self._lock = RLock()

    @property
    def model(self):
        with self._lock:
            if self._model is None:
                from sentence_transformers import CrossEncoder
                self._model = CrossEncoder(self.settings.reranker_model, device="cpu")
            return self._model

    def score(self, query: str, passages: list[str]) -> list[float]:
        import torch
        if not passages:
            return []
        scores = self.model.predict([(query, passage) for passage in passages],
                                    activation_fn=torch.nn.Sigmoid(),
                                    show_progress_bar=False)
        return [float(value) for value in scores]


def warm_models(settings: Settings | None = None, embedding=None):
    """Download and exercise local models during setup, never on an LLM API."""
    settings = settings or get_settings()
    embedding = embedding if embedding is not None else Embedding(settings)
    embedding.embed_query("Google Cloud documentation")
    Reranker(settings).score("Google Cloud documentation", ["Google Cloud documentation"])
