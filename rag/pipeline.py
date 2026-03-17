
from rag.retriever import Retriever
from rag.generator import Generator

class Pipeline:

    def __init__(self):
        self.retriever = Retriever()
        self.generator = Generator()

    def run(self, question: str):
        """
        Main pipeline for document processing and retrieval.
        parameters:
            question: The user's query for which documents are retrieved and used for generation.
        """
        documents = self.retriever.retrieve(query=question)
        content = "\n\n".join([doc.page_content for doc in documents])
        response = self.generator.generate_with_context(content, question)
        return response

    def __call__(self, question: str):
        return self.run(question)