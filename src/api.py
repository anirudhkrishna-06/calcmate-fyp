"""Combined development service: accounts plus the unchanged RAG HTTP routes."""
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from src.rag_api import app
from src.auth_api import router
from src.admin_api import router as admin_router, admin_lifespan
from src.learner_api import router as learner_router
from src.allocation_engine import router as planning_router

app.include_router(router)
app.include_router(admin_router)
app.include_router(learner_router)
app.include_router(planning_router)
app.router.lifespan_context = admin_lifespan



@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Never echo password/token input in a Pydantic validation response.
    locations=[str(part) for error in exc.errors() for part in error.get('loc',())]
    if 'classroom_evidence' in locations:
        detail='Classroom evidence is invalid, too large, or uses an outdated curriculum. Update app and server together and select fewer grades.'
    elif 'db_path' in locations:
        detail='Server database paths are not accepted. Send approved classroom evidence.'
    else:
        detail='Check the submitted fields and password length.'
    return JSONResponse(status_code=422, content={"detail":detail})


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
