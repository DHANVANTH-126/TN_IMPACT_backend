const { Client } = require('@elastic/elasticsearch');
require('dotenv').config();

let esClient = null;
let esAvailable = false;

async function initElasticsearch() {
  try {
    esClient = new Client({ node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200' });
    await esClient.ping();
    esAvailable = true;
    console.log('✅ Elasticsearch connected');

    // Create documents index if not exists
    const indexExists = await esClient.indices.exists({ index: 'documents' });
    if (!indexExists) {
      await esClient.indices.create({
        index: 'documents',
        body: {
          mappings: {
            properties: {
              title: { type: 'text', analyzer: 'standard' },
              description: { type: 'text', analyzer: 'standard' },
              tags: { type: 'keyword' },
              department: { type: 'keyword' },
              owner_name: { type: 'text' },
              status: { type: 'keyword' },
              created_at: { type: 'date' },
            },
          },
        },
      });
      console.log('✅ Elasticsearch "documents" index created');
    }
  } catch (err) {
    console.warn('⚠️  Elasticsearch unavailable — search will fall back to PostgreSQL');
    esAvailable = false;
  }
}

initElasticsearch();

module.exports = { getClient: () => esClient, isAvailable: () => esAvailable };
