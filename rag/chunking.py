from langchain_core.documents import Document
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from config.config import Config


class Chunker:
    def __init__(self,config: type[Config] = Config):
        self.chunk_size = config.CHUNK_SIZE
        self.chunk_overlap = config.CHUNK_OVERLAP
        self.headers_to_split_on = [
        ("#", "Header 1"),
        ("##", "Header 2"),
        ("###", "Header 3"),
    ]
        self.markdown_splitter = MarkdownHeaderTextSplitter(
            headers_to_split_on=self.headers_to_split_on)
        self.recursive_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap)

    def split_markdown_headers(self, content: str) -> list[Document]:
        """
        Splits text into chunks based on Markdown headers.
            parameters:
            content: The input text to be split into chunks.
        """
        return self.markdown_splitter.split_text(content)

    def split_recursive(self, content: list[Document]) -> list[Document]:
        """
        Splits text into chunks recursively.
            parameters:
            content: The input text to be split into chunks.
        """
        return self.recursive_splitter.split_documents(content)


    def chunk(self, content: str) -> list[Document]:
        """
        Orchestrates the chunking process by first splitting the content into chunks based on Markdown headers, and then splitting the remaining chunks recursively.
        parameter:
            content: The input text to be split into chunks.
        """
        headers_chunks = self.split_markdown_headers(content)
        return self.split_recursive(headers_chunks)