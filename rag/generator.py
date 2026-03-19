from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from config.config import Config
class Generator:
    def __init__(self, config: type[Config] = Config):
        self.groq_api_key = config.GROQ_API_KEY
        self.model = ChatGroq(model="llama-3.3-70b-versatile", temperature = 0.2, max_tokens = 1000, api_key=self.groq_api_key)

    def generate_with_context(self, context: str, question: str):
        """
        Generate a response based on the provided context and question. Only in English.

        parameters:
            context: The context information to be used for generating the response.
            question: The user's query for which the response is generated.
        """
        prompt = ChatPromptTemplate.from_messages([("system", "You are a assistant specialized in GCP, friendly and professional. Do not answer any other subject outside GCP. Answer only based on the context provided below. If you do not know the answer, say explicitly that you do not know and suggest that try another way."),
                                               ("system", "Context: {context}"),
                                               ("user", "Question: {question}")])
        chain = prompt | self.model
        response = chain.invoke({"context": context, "question": question})
        return response.content

