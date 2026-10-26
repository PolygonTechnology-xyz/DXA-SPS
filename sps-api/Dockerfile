# Debian-based Bun image: the document tools below (LibreOffice above all) are far more
# reliable on Debian than on Alpine.
FROM oven/bun:1-slim

# Programs the API runs (src/services/ingest.ts, src/services/outputs.ts):
#   python3 + openpyxl        Excel/CSV uploads, Excel downloads
#   poppler-utils             pdfinfo, pdftotext, pdftoppm, pdfseparate, pdfunite (PDFs, scans)
#   libreoffice-*             Word / Excel / PowerPoint → PDF (soffice)
#   unzip, procps             reading Office files, pkill for a stuck soffice
#   fonts-noto-core           Bangla and other scripts in converted documents
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-openpyxl \
      poppler-utils \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      unzip procps \
      fonts-noto-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 8787
CMD ["bun", "server.ts"]
