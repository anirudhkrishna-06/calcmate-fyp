"""Combined development service: accounts plus the unchanged RAG HTTP routes."""
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from src.rag_api import app
from src.auth_api import router
from src.admin_api import router as admin_router, admin_lifespan
from src.learner_api import router as learner_router

app.include_router(router)
app.include_router(admin_router)
app.include_router(learner_router)
app.router.lifespan_context = admin_lifespan



@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Never echo password/token input in a Pydantic validation response.
    return JSONResponse(status_code=422, content={"detail": "Check the submitted fields and password length."})


def main():
    """Run the combined service; use --host 0.0.0.0 for LAN devices."""
    import argparse
    import os
    import uvicorn

    parser = argparse.ArgumentParser(description="CalcMate accounts and assistant API")
    parser.add_argument("--host", default=os.getenv("CALCMATE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("CALCMATE_PORT", "8000")))
    args = parser.parse_args()
    uvicorn.run("src.api:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
