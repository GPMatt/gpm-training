# Cloud RUN, not a Cloud Functions buildpack.
#
# The parser shells out to poppler's `pdftotext -layout`, and none of the
# managed Python runtimes ship poppler. More importantly, `-layout` is what
# preserves the column geometry every pattern in parse_statement.py depends on,
# and its spacing behaviour varies between poppler releases. Owning the image
# means the binary that parses a statement in production is the same one the
# test suite was validated against.
#
# Pin the base image by digest before this handles real money — a floating
# `:slim` tag can move poppler underneath you between deploys, and a column
# spaced one character differently is exactly the kind of change that would
# show up as a mysterious parse failure rather than as an upgrade.
FROM python:3.12-slim

# poppler-utils provides pdftotext. Version is printed by /healthz and echoed
# in every parse response, so drift is visible rather than inferred.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The parser itself is the file the test suite runs against, copied in
# unmodified — there is no service-specific fork of the parsing logic.
COPY parse_statement.py .
COPY main.py .

# Cloud Run injects PORT. One worker: a parse is CPU-bound for a second or two
# and this is invoked once a month, so concurrency buys nothing and a second
# worker only doubles the idle memory footprint.
ENV PORT=8080
CMD exec gunicorn --bind :$PORT --workers 1 --threads 4 --timeout 120 main:app
