# System Architecture Documentation

This document provides a comprehensive overview of the Blockchain Transaction Consumer Service architecture, including detailed explanations of system components, data flows, and design decisions.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagrams](#architecture-diagrams)
3. [Component Details](#component-details)
4. [Data Flow Patterns](#data-flow-patterns)
5. [Cross-Chain Design](#cross-chain-design)
6. [Security Considerations](#security-considerations)
7. [Scalability & Performance](#scalability--performance)

## System Overview

The Blockchain Transaction Consumer Service is a **microservice-based architecture** designed to process blockchain events in real-time, manage cross-chain NFT collateral, and provide DeFi lending capabilities. The system follows **event-driven architecture** patterns with **Redis pub/sub** for message processing and **PostgreSQL** for persistent storage.

### Key Design Principles

- **Event-Driven Architecture**: Reactive processing of blockchain events
- **Microservice Separation**: Clear boundaries between business domains  
- **Cross-Chain Compatibility**: Multi-blockchain support with unified interfaces
- **Real-Time Processing**: Immediate event processing and response
- **Cryptographic Security**: Merkle proofs for trustless verification
- **Scalable Infrastructure**: Horizontal scaling capabilities

## Architecture Diagrams

### High-Level System Architecture

```mermaid
graph TB
    subgraph "External Systems"
        BC1[Base Sepolia<br/>Blockchain]
        BC2[Arbitrum Sepolia<br/>Blockchain] 
        PRODUCER[Producer Service<br/>poc-producers]
    end

    subgraph "Message Queue"
        REDIS[Redis Pub/Sub<br/>Event Distribution]
    end

    subgraph "Consumer Service - poc-consumers"
        direction TB
        
        subgraph "Application Layer"
            APP[Express Application<br/>src/index.ts]
            ROUTES[API Routes<br/>REST Endpoints]
        end
        
        subgraph "Business Logic"
            CONSUMER[Redis Consumer<br/>Message Processing]
            
            subgraph "Core Services"
                NFT_SVC[NFT Transfer Service<br/>ERC721 Processing]
                VAULT_SVC[Vault Event Service<br/>Collateral Management]
                RELAY_SVC[Relayer Service<br/>Cross-Chain Lending]
                MERKLE_SVC[Merkle Service<br/>Proof Generation]
                USER_SVC[User Service<br/>Account Management]
                PRICE_SVC[Pricing Service<br/>Asset Valuation]
            end
        end
        
        subgraph "Data Layer"
            ORM[TypeORM<br/>Database Abstraction]
            ENTITIES[Entity Models<br/>Data Schemas]
        end
    end

    subgraph "Persistence Layer"
        DB[(PostgreSQL<br/>Primary Database)]
        REDIS_CACHE[(Redis<br/>Caching & Sessions)]
    end

    subgraph "Smart Contracts"
        NFT_CONTRACT[ERC721 NFT Contract]
        VAULT_CONTRACT[Vault Contract]
        RELAYER_CONTRACT[Relayer Contract]
    end

    %% External Data Flow
    BC1 --> PRODUCER
    BC2 --> PRODUCER
    PRODUCER --> REDIS

    %% Internal Data Flow
    REDIS --> CONSUMER
    APP --> ROUTES
    APP --> CONSUMER
    
    CONSUMER --> NFT_SVC
    CONSUMER --> VAULT_SVC
    CONSUMER --> RELAY_SVC
    
    NFT_SVC --> MERKLE_SVC
    VAULT_SVC --> USER_SVC
    RELAY_SVC --> USER_SVC
    RELAY_SVC --> PRICE_SVC
    
    %% Data Persistence
    NFT_SVC --> ORM
    VAULT_SVC --> ORM
    RELAY_SVC --> ORM
    USER_SVC --> ORM
    MERKLE_SVC --> ORM
    
    ORM --> ENTITIES
    ENTITIES --> DB
    
    %% Smart Contract Interactions
    MERKLE_SVC --> RELAYER_CONTRACT
    PRICE_SVC --> NFT_CONTRACT
    PRICE_SVC --> VAULT_CONTRACT

    %% Styling
    classDef external fill:#e1f5fe,stroke:#01579b
    classDef message fill:#f3e5f5,stroke:#4a148c
    classDef app fill:#e8f5e8,stroke:#1b5e20
    classDef service fill:#fff3e0,stroke:#e65100
    classDef data fill:#fce4ec,stroke:#880e4f
    classDef contract fill:#f1f8e9,stroke:#33691e

    class BC1,BC2,PRODUCER external
    class REDIS,REDIS_CACHE message
    class APP,ROUTES,CONSUMER,NFT_SVC,VAULT_SVC,RELAY_SVC,MERKLE_SVC,USER_SVC,PRICE_SVC app
    class ORM,ENTITIES service
    class DB data
    class NFT_CONTRACT,VAULT_CONTRACT,RELAYER_CONTRACT contract
```

### Message Processing Pipeline

```mermaid
graph LR
    subgraph "Message Processing Pipeline"
        INCOMING[Incoming Redis<br/>Message]
        PARSE[Message Parser<br/>& Normalizer]
        VALIDATE[Schema<br/>Validation]
        ROUTE[Event Router<br/>& Dispatcher]
        
        subgraph "Processing Services"
            NFT_PROC[NFT Transfer<br/>Processing]
            VAULT_PROC[Vault Event<br/>Processing]
            RELAY_PROC[Relayer Event<br/>Processing]
        end
        
        subgraph "Storage Operations"
            TXN_STORE[Transaction<br/>Storage]
            EVENT_STORE[Event<br/>Storage]
            USER_UPDATE[User Balance<br/>Updates]
        end
        
        subgraph "Post-Processing"
            MERKLE_GEN[Merkle Tree<br/>Generation]
            CHAIN_SUBMIT[Blockchain<br/>Submission]
            NOTIFY[Event<br/>Notifications]
        end
    end

    INCOMING --> PARSE
    PARSE --> VALIDATE
    VALIDATE --> ROUTE
    
    ROUTE --> NFT_PROC
    ROUTE --> VAULT_PROC
    ROUTE --> RELAY_PROC
    
    NFT_PROC --> TXN_STORE
    VAULT_PROC --> EVENT_STORE
    RELAY_PROC --> USER_UPDATE
    
    NFT_PROC --> MERKLE_GEN
    VAULT_PROC --> USER_UPDATE
    RELAY_PROC --> NOTIFY
    
    MERKLE_GEN --> CHAIN_SUBMIT
    
    classDef input fill:#e3f2fd
    classDef process fill:#f3e5f5
    classDef storage fill:#e8f5e8
    classDef output fill:#fff3e0
    
    class INCOMING input
    class PARSE,VALIDATE,ROUTE,NFT_PROC,VAULT_PROC,RELAY_PROC process
    class TXN_STORE,EVENT_STORE,USER_UPDATE storage
    class MERKLE_GEN,CHAIN_SUBMIT,NOTIFY output
```

### Database Entity Relationships

```mermaid
erDiagram
    Users ||--o{ Deposits : "has many"
    Users ||--o{ Withdrawals : "has many"
    Users ||--o{ Borrows : "has many"
    Users ||--o{ RelayerEvents : "initiates"
    Users ||--|| PocNft : "owns"
    
    ProcessedTransactions ||--o{ NftTransfers : "contains"
    ProcessedTransactions ||--o{ VaultEvents : "contains"
    ProcessedTransactions ||--o{ RelayerEvents : "contains"
    
    NftTransfers }|--|| PocNft : "transfers"
    
    VaultEvents ||--o{ Deposits : "records"
    VaultEvents ||--o{ Withdrawals : "records"
    
    RelayerEvents ||--o{ Borrows : "creates"

    Users {
        uuid id PK
        string wallet_address UK
        decimal total_usd_balance
        decimal floating_usd_balance
        decimal borrowed_usd_amount
        timestamp created_at
        timestamp updated_at
    }
    
    ProcessedTransactions {
        uuid id PK
        int chain_id
        string chain_name
        string transaction_hash UK
        int block_number
        string block_hash
        string sender_address
        string receiver_address
        string transaction_value
        text transaction_data
        bigint transaction_timestamp
        jsonb transaction_details
        string processing_status
        timestamp created_at
        timestamp updated_at
    }
    
    NftTransfers {
        uuid id PK
        int chain_id
        string chain_name
        string transaction_hash
        int block_number
        string block_hash
        string token_address
        string token_id
        string from_address
        string to_address
        bigint transaction_timestamp
        boolean included_in_merkle
        string merkle_root
        timestamp created_at
        timestamp updated_at
    }
    
    VaultEvents {
        uuid id PK
        int chain_id
        string chain_name
        string transaction_hash
        int block_number
        string block_hash
        string type
        string sender
        string recipient
        string asset
        string amount
        int token_id
        string request_id
        int status
        bigint transaction_timestamp
        timestamp created_at
        timestamp updated_at
    }
    
    RelayerEvents {
        uuid id PK
        int chain_id
        string transaction_hash
        string request_id
        string type
        int token_id
        string protocol
        string asset
        string sender
        string amount
        bigint deadline
        text data
        text signature
        int status
        string process_transaction_hash
        text error_data
        int block_number
        timestamp timestamp
        timestamp created_at
        timestamp updated_at
    }
    
    PocNft {
        uuid id PK
        int token_id UK
        string contract_address
        uuid user_id FK
        timestamp created_at
        timestamp updated_at
    }
    
    Deposits {
        uuid id PK
        uuid user_id FK
        string tx_hash
        int chain_id
        string asset
        string amount
        string sender
        string recipient
        int token_id
        int status
        timestamp timestamp
        timestamp created_at
        timestamp updated_at
    }
    
    Withdrawals {
        uuid id PK
        uuid user_id FK
        string tx_hash
        int chain_id
        string asset
        string amount
        string sender
        string recipient
        int token_id
        string request_id
        int status
        timestamp timestamp
        timestamp created_at
        timestamp updated_at
    }
    
    Borrows {
        uuid id PK
        uuid user_id FK
        decimal borrowed_usd_amount
        decimal collateral_ratio
        decimal interest_rate
        timestamp loan_start_date
        timestamp loan_end_date
        string status
        string token_sent_address
        string token_amount
        string transaction_hash
        timestamp created_at
        timestamp updated_at
    }
```

## Component Details

### 1. Redis Consumer Service

**Location**: `src/redis/consumer.ts`

**Responsibilities**:
- Subscribe to Redis pub/sub channels for blockchain events
- Parse and normalize incoming message formats (legacy + enhanced)
- Route messages to appropriate processing services
- Handle connection management and error recovery
- Provide consumer control API (pause/resume/status)

**Key Features**:
- **Dual Format Support**: Handles both legacy and enhanced message structures
- **Graceful Degradation**: Continues processing if individual messages fail
- **Connection Resilience**: Automatic reconnection on Redis failures
- **Backpressure Handling**: Prevents message queue overflow

### 2. NFT Transfer Service

**Location**: `src/services/NftTransferService.ts`

**Responsibilities**:
- Extract ERC721 Transfer events from transaction logs
- Decode transfer parameters (from, to, tokenId)
- Store NFT ownership changes in database
- Trigger automatic Merkle tree generation
- Submit Merkle roots to relayer contracts

**Technical Implementation**:
```typescript
// Event signature for ERC721 Transfer
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Decode transfer event
const fromAddress = ethers.getAddress("0x" + log.topics[1].slice(26));
const toAddress = ethers.getAddress("0x" + log.topics[2].slice(26)); 
const tokenId = ethers.toBigInt(log.topics[3]);
```

### 3. Merkle Service

**Location**: `src/services/MerkleService.ts`

**Responsibilities**:
- Generate cryptographic Merkle trees from NFT ownership data
- Create verifiable proofs for cross-chain verification
- Submit Merkle roots to multiple relayer contracts
- Maintain proof history for audit trails

**Merkle Tree Construction**:
```typescript
// Create leaf for each NFT ownership
const leaf = ethers.solidityPackedKeccak256(
  ["address", "uint256"],
  [ownerAddress, tokenId]
);

// Build Merkle tree with sorted pairs
const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
const root = merkleTree.getRoot().toString("hex");
```

### 4. Vault Event Service

**Location**: `src/services/VaultEventService.ts`

**Responsibilities**:
- Process deposit, withdrawal request, and withdrawal events
- Maintain user collateral balances across chains
- Validate withdrawal requests against available collateral
- Enforce chain-specific withdrawal constraints
- Calculate USD values for cross-chain operations

### 5. Relayer Service

**Location**: `src/services/RelayerService.ts`

**Responsibilities**:
- Handle collateral requests and processing events
- Verify NFT ownership through Merkle proofs
- Calculate loan-to-value (LTV) ratios
- Process cross-chain borrow requests
- Manage borrow approval/rejection workflow

## Data Flow Patterns

### Event Processing Flow

```mermaid
sequenceDiagram
    participant BC as Blockchain
    participant PROD as Producer
    participant REDIS as Redis
    participant CONS as Consumer
    participant SVC as Service Layer
    participant DB as Database
    participant SC as Smart Contract

    BC->>PROD: New Block/Transaction
    PROD->>PROD: Extract Events
    PROD->>REDIS: Publish Message
    
    REDIS->>CONS: Message Delivery
    CONS->>CONS: Parse & Validate
    CONS->>SVC: Route to Service
    
    alt NFT Transfer Event
        SVC->>DB: Store Transfer
        SVC->>SVC: Generate Merkle Tree
        SVC->>SC: Submit Merkle Root
    end
    
    alt Vault Event
        SVC->>DB: Store Vault Event
        SVC->>DB: Update User Balance
    end
    
    alt Relayer Event
        SVC->>SVC: Verify NFT Ownership
        SVC->>DB: Create Borrow Record
        SVC->>SC: Execute Borrow
    end
```

### Cross-Chain Collateral Flow

```mermaid
sequenceDiagram
    participant USER as User
    participant CHAIN_A as Base Sepolia
    participant CHAIN_B as Arbitrum Sepolia
    participant SERVICE as Consumer Service
    participant DB as Database

    Note over USER,DB: Deposit on Chain A
    USER->>CHAIN_A: Deposit Collateral
    CHAIN_A->>SERVICE: Deposit Event
    SERVICE->>DB: Record Deposit (Chain A)
    
    Note over USER,DB: Borrow on Chain B
    USER->>CHAIN_B: Request Borrow
    CHAIN_B->>SERVICE: Borrow Request Event
    SERVICE->>DB: Check Total Collateral (All Chains)
    DB-->>SERVICE: Available Collateral
    SERVICE->>SERVICE: Calculate LTV
    
    alt LTV Within Limits
        SERVICE->>CHAIN_B: Approve Borrow
        SERVICE->>DB: Record Borrow
    else LTV Exceeds Limits
        SERVICE->>CHAIN_B: Reject Borrow
    end
```

## Cross-Chain Design

### Multi-Chain Support Architecture

The system is designed to support multiple blockchain networks through a **unified interface pattern**:

1. **Chain Configuration**: Standardized chain definitions with RPC URLs, contract addresses, and asset configurations
2. **Event Normalization**: Common event structure across different blockchain implementations  
3. **Cross-Chain Aggregation**: Unified view of user assets and collateral across all supported chains
4. **Chain-Specific Constraints**: Enforcement of withdrawal limitations to originating chains

### Supported Networks

- **Base Sepolia (Primary)**: NFT contract deployment and primary operations
- **Arbitrum Sepolia (Secondary)**: Cross-chain lending and collateral verification
- **Extensible Design**: Additional chains can be added through configuration

## Security Considerations

### Cryptographic Security

1. **Merkle Proofs**: Cryptographically secure ownership verification
2. **Private Key Management**: Secure handling of blockchain transaction signing
3. **Message Validation**: Schema validation for all incoming events
4. **Database Integrity**: Foreign key constraints and transaction atomicity

### Cross-Chain Security

1. **Ownership Verification**: Merkle proof validation before cross-chain operations
2. **LTV Enforcement**: Strict loan-to-value ratio limits
3. **Chain Isolation**: Withdrawal restrictions to prevent cross-chain exploits
4. **Event Deduplication**: Prevention of duplicate event processing

## Scalability & Performance

### Horizontal Scaling

- **Stateless Services**: All business logic services are stateless and horizontally scalable
- **Database Connection Pooling**: Efficient database connection management
- **Redis Clustering**: Support for Redis cluster deployments
- **Load Balancing**: API layer can be load balanced across multiple instances

### Performance Optimizations

- **Batch Processing**: Efficient batch operations for database writes
- **Indexed Queries**: Optimized database indexes for common query patterns
- **Caching Strategy**: Redis caching for frequently accessed data
- **Async Processing**: Non-blocking I/O for blockchain interactions

### Monitoring & Observability

- **Structured Logging**: Winston-based logging with multiple levels
- **Health Checks**: Comprehensive health check endpoints
- **Metrics Collection**: Performance and business metrics tracking
- **Error Handling**: Graceful error handling with proper logging and recovery 