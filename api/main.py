from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from rag.pipeline import Pipeline


class Question(BaseModel):
    question: str


pipeline = Pipeline()
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/ask/")
def ask_question(question: Question):
    response = pipeline.run(question.question)
    return {"answer": response}
