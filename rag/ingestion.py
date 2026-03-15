from config.config import Config
from rag.chunking import Chunker
from storage.bucket_storage import BucketStorage
from rag.indexer import Indexer


class Ingestion:
    def __init__(self, config: type[Config] = Config):
        self.raw_bucket_name = config.RAW_BUCKET_NAME
        self.bucket = BucketStorage()
        self.chunker = Chunker()
        self.indexer = Indexer()

    def run (self):
        """
        Run the ingestion process to chunk, embed, and move files.
        """
        list_files = self.bucket.list_files(self.raw_bucket_name)

        for file in list_files:
            try:
                read_files = self.bucket.read_object(file)
                chunks = self.chunker.chunk(read_files)
                self.indexer.add_documents(chunks)
                self.bucket.move_files(file)
            except Exception as e:
                print(f"Error processing file {file}: {e}")
                continue