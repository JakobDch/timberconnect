FROM python:3.11-slim

# Install Java and curl for RMLMapper
RUN apt-get update && \
    apt-get install -y --no-install-recommends openjdk-21-jre-headless curl && \
    rm -rf /var/lib/apt/lists/*

# Download RMLMapper JAR
RUN mkdir -p /app/lib && \
    curl -L -o /app/lib/rmlmapper.jar \
    https://github.com/RMLio/rmlmapper-java/releases/download/v7.2.0/rmlmapper-7.2.0-r374-all.jar

# Set Java environment
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create temp directory for file processing
RUN mkdir -p /app/temp

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
