# Review packet, group 3

Scenarios in this packet: product-search, nightly-reports-serverless, regulated-portal. Read `reviewer-instructions.md` for the task and the output format.

## Rubric

Score each design on seven dimensions, each 0-3 (0 = critical defect, 3 = production-grade for an MVP-level design).

| Dimension | What is checked |
|---|---|
| requirementCoverage | All explicit requirements are reflected; assumptions are marked |
| serviceFitness | Service choices are justified; nothing redundant or expensive without reason |
| connectionCorrectness | Direction, semantics, protocols and integrations are correct |
| securityBaseline | Auth, least privilege, private data not public, encryption |
| reliabilityOperability | Error handling, DLQs, observability, fault tolerance |
| costAwareness | No obvious overspend; serverless/managed where appropriate |
| explanationAccuracy | Rationale and connection descriptions are technically correct |

**Critical defect:** any dimension scored 0, or any incorrect technical statement that would lead the user to an insecure or non-working solution.

**Defect severities:** `minor` (cosmetic or small improvement), `major` (a real weakness or wrong detail that a careful architect would fix before building), `critical` (see above).

**Documentation rule:** every `major` or `critical` defect must cite an official AWS documentation or Well-Architected URL in its `evidence` field. A claim you cannot support with documentation should be recorded as `minor`.

---

## Scenario: product-search

**User prompt**

> Our e-commerce site has 2 million products in a relational database that stays the source of truth. Shoppers need fast full-text search with typo tolerance and filters (brand, price, size). Product pages are read far more often than they change, and price updates must appear in search within a minute. The web API runs in containers.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [constraint, confirmed] Keep the existing relational database as the source of truth for the 2 million products.
- R2 [functional, confirmed] Provide fast full-text search over products.
- R3 [functional, confirmed] Search must tolerate typos.
- R4 [functional, confirmed] Search must support filters on brand, price, and size.
- R5 [non-functional, confirmed] Product pages are read far more often than they change, so reads must be optimized over writes.
- R6 [non-functional, confirmed] Price updates must appear in search results within one minute of the change.
- R7 [constraint, confirmed] The web API runs in containers.
- R8 [functional, inferred] Search index must be kept in sync with the relational database changes.
- R9 [non-functional, inferred] Product detail data should be served with low latency and cached for repeated reads.
- R10 [non-functional, inferred] Search should scale to handle traffic spikes from shoppers.
- I1 [non-functional, inferred] Sync pipeline failures and lag must be visible and alarmed, including DLQ depth.
- I2 [non-functional, inferred] The public entry point must be protected against malicious traffic.

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-cloud]
  - Region (Region) [c-region]
    - VPC (VPC) [c-vpc]
      - Availability Zone A (Availability Zone) [c-az-a]
        - Public subnet A (Subnet, public) [c-pub-a]
        - Private subnet A (Subnet, private) [c-priv-a]
      - Availability Zone B (Availability Zone) [c-az-b]
        - Public subnet B (Subnet, public) [c-pub-b]
        - Private subnet B (Subnet, private) [c-priv-b]

**Nodes**

- **Shopper** [n-shopper] - EXTERNAL user: Shopper
  - purpose: Browses and searches products over the internet
  - rationale: External users access the site from outside AWS
  - satisfies: R2, R5
- **CloudFront** [n-cf] - service: Amazon CloudFront
  - in container: AWS Cloud
  - purpose: Caches product pages at the edge and serves the site over TLS
  - rationale: Read-heavy product pages are served from edge caches, reducing origin load
  - satisfies: R5, R9
- **AWS WAF** [n-waf] - service: AWS WAF
  - in container: Region
  - purpose: Filters malicious requests before they reach CloudFront
  - rationale: Protects the public entry point against common web attacks
  - satisfies: I2
- **Application Load Balancer** [n-alb] - service: Application Load Balancer
  - in container: Public subnet A
  - purpose: Distributes API requests across container tasks in two Availability Zones
  - rationale: Spreads traffic across zones to absorb shopper spikes
  - satisfies: R7, R10
- **Web API containers** [n-api] - service: AWS Fargate
  - in container: Private subnet A
  - purpose: Runs the containerized web API for product pages and search
  - rationale: Fargate runs containers without managing servers and scales with traffic
  - satisfies: R7, R9, R2
- **Product detail cache** [n-cache] - service: Amazon ElastiCache
  - in container: Private subnet A
  - purpose: Caches product detail reads in memory
  - rationale: Repeated reads are served from memory and invalidated when prices change
  - satisfies: R5, R9, R6
- **RDS Proxy** [n-proxy] - service: Amazon RDS Proxy
  - in container: Private subnet A
  - purpose: Pools database connections from the API and sync function
  - rationale: Keeps database connections stable during bursts
  - satisfies: R1
- **Product database (source of truth)** [n-rds] - service: Amazon RDS
  - in container: Private subnet A
  - purpose: Holds the 2 million products and prices as the authoritative record
  - rationale: The existing relational database remains the source of truth
  - configuration backup: automated
  - configuration encryption: AWS-managed
  - satisfies: R1, R8
- **Sync schedule** [n-eb] - service: Amazon EventBridge
  - in container: Region
  - purpose: Triggers the sync function every minute
  - rationale: A one-minute schedule meets the price freshness target
  - satisfies: R6, R8
- **Index sync function** [n-sync] - service: AWS Lambda
  - in container: Region
  - purpose: Reads changed products and prices, updates the search index and invalidates cache entries
  - rationale: Serverless polling keeps the search index in step with database changes within a minute
  - satisfies: R6, R8, R2
- **Product search index** [n-os] - service: Amazon OpenSearch Service
  - in container: Region
  - purpose: Full-text search with fuzzy matching, filters and facets
  - rationale: Typo-tolerant search with brand, price and size filters that scales for spikes
  - satisfies: R2, R3, R4, R10
- **Sync failure queue** [n-dlq] - service: Amazon SQS
  - in container: Region
  - purpose: Holds sync events that failed processing for retry and investigation
  - rationale: Captures failed sync runs so no product change is silently lost
  - satisfies: R8, I1
- **CloudWatch** [n-cw] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Collects metrics and logs and raises alarms on sync lag and DLQ depth
  - rationale: Makes sync failures and lag visible to operators
  - satisfies: I1

**Edges**

- Shopper -> CloudFront (invoke, HTTPS): Browse and search
  - satisfies: R2, R5
- AWS WAF -> CloudFront (other): Protects
  - satisfies: I2
- CloudFront -> Application Load Balancer (origin, HTTPS): Cache miss to origin
  - satisfies: R5, R9
- Application Load Balancer -> Web API containers (invoke, HTTP): Routes API requests
  - satisfies: R7, R10
- Web API containers -> Product detail cache (read, Redis): Read cached product
  - satisfies: R9
- Web API containers -> RDS Proxy (read, PostgreSQL): Read product on cache miss
  - satisfies: R1, R9
- RDS Proxy -> Product database (source of truth) (read, PostgreSQL): Query products and prices
  - satisfies: R1
- Web API containers -> Product search index (invoke, HTTPS): Search query with filters
  - satisfies: R2, R3, R4
- Sync schedule -> Index sync function (event): Every minute
  - configuration failureDestination: SQS
  - satisfies: R6, R8
- Index sync function -> RDS Proxy (read, PostgreSQL): Read changed products and prices
  - satisfies: R8, R6
- Index sync function -> Product search index (write, HTTPS): Upsert product documents
  - satisfies: R8, R6, R2
- Index sync function -> Product detail cache (write, Redis): Invalidate cached product
  - satisfies: R6, R9
- Index sync function -> Sync failure queue (event): Failed sync events
  - configuration failureDestination: SQS
  - satisfies: R8, I1
- CloudWatch -> Sync failure queue (other): Alarms on DLQ depth
  - satisfies: I1

### Design B

**Requirements**

- R1 [constraint, confirmed] Keep the existing relational database of 2 million products as the source of truth.
- R2 [functional, confirmed] Provide fast full-text search over products for shoppers.
- R3 [functional, confirmed] Search must tolerate typos.
- R4 [functional, confirmed] Search must support filters on brand, price, and size.
- R5 [non-functional, confirmed] Product pages are read far more often than they change, so reads must be optimized over writes.
- R6 [non-functional, confirmed] Price updates must appear in search results within one minute of the change.
- R7 [constraint, confirmed] The web API runs in containers and must be deployable as containers.
- R8 [functional, inferred] Search index must be kept in sync with the relational database as products change.
- R9 [non-functional, inferred] Product page reads should be served with low latency, likely via caching.
- R10 [non-functional, inferred] Search should scale to handle shopper traffic spikes without degrading.
- I1 [non-functional, inferred] Re-indexing must be idempotent and retryable, with failed sync messages captured in a dead-letter queue and alarmed on.
- I2 [functional, inferred] Initial full load of the 2 million products into the search index, and the ability to rebuild it from the database.
- I3 [non-functional, inferred] Public API must be authenticated or throttled and protected from common web attacks; data stores encrypted and backed up; database highly available.

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Region (Region) [region]
    - Application VPC (VPC) [vpc]
      - AZ 1 (Availability Zone) [az1]
        - Public subnet 1 (Subnet, public) [pub1]
        - Private app subnet 1 (Subnet, private) [app1]
        - Private data subnet 1 (Subnet, private) [data1]
      - AZ 2 (Availability Zone) [az2]
        - Public subnet 2 (Subnet, public) [pub2]
        - Private app subnet 2 (Subnet, private) [app2]
        - Private data subnet 2 (Subnet, private) [data2]

**Nodes**

- **Shopper** [shopper] - EXTERNAL user: Shopper browser
  - purpose: Browses products and searches
  - rationale: Client of the public web API
  - satisfies: R2, R5
- **WAF** [waf] - service: AWS WAF
  - purpose: Rate limiting and web attack protection for the ALB
  - rationale: Protects the public entry point and helps absorb traffic spikes
  - satisfies: I3, R10
- **Application Load Balancer** [alb] - service: Application Load Balancer
  - purpose: Distributes HTTPS traffic to API containers
  - rationale: Spans two AZs for availability
  - satisfies: R7, R10, I3
- **ACM certificate** [acm] - service: AWS Certificate Manager
  - purpose: TLS certificate for the ALB
  - rationale: Encrypts traffic in transit
  - satisfies: I3
- **ECS cluster** [ecs] - service: Amazon ECS
  - purpose: Orchestrates the containerized web API
  - rationale: Deploys the API as containers
  - satisfies: R7
- **Web API tasks (AZ1)** [api1] - service: AWS Fargate
  - purpose: Runs API containers serving product pages and search
  - rationale: Serverless containers, no servers to manage
  - satisfies: R7, R10, R5
- **Web API tasks (AZ2)** [api2] - service: AWS Fargate
  - purpose: Runs API containers in the second AZ
  - rationale: Multi-AZ resilience and scaling
  - satisfies: R7, R10
- **Product cache (Valkey)** [cache] - service: Amazon ElastiCache
  - purpose: Caches product page data
  - rationale: Low-latency reads for read-heavy product pages
  - configuration multiAz: enabled
  - configuration encryption: KMS
  - configuration backup: snapshots
  - satisfies: R5, R9
- **Product database (RDS)** [db] - service: Amazon RDS
  - purpose: Source of truth for 2 million products
  - rationale: Keeps the existing relational database
  - configuration multiAz: enabled
  - configuration backup: automated
  - configuration encryption: KMS
  - satisfies: R1, R8, I3
- **Product search index** [opensearch] - service: Amazon OpenSearch Service
  - purpose: Full-text search with fuzzy matching and filters
  - rationale: Supports typo tolerance, brand, price and size filters and scales with replicas and data nodes
  - satisfies: R2, R3, R4, R10
- **Product change queue** [queue] - service: Amazon SQS
  - purpose: Buffers product-changed messages
  - rationale: Decouples database writes from indexing and absorbs bursts
  - configuration encryption: KMS
  - satisfies: R8, R6, I1, I2
- **Indexing DLQ** [dlq] - service: Amazon SQS
  - purpose: Holds messages that failed indexing
  - rationale: Prevents poison messages from blocking sync
  - configuration encryption: KMS
  - satisfies: I1
- **Indexer function** [indexer] - service: AWS Lambda
  - purpose: Reads the current product row and upserts it into OpenSearch
  - rationale: Idempotent upsert by product id and version; partial batch responses report failed items
  - satisfies: R6, R8, I1, I2
- **Customer managed key** [kms] - service: AWS KMS
  - purpose: Encryption keys for data stores and queues
  - rationale: Encryption at rest
  - satisfies: I3
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - purpose: Logs, metrics and alarms including DLQ depth and queue age
  - rationale: Alerts when price updates risk missing the one-minute target
  - satisfies: I1, R6

**Edges**

- Shopper -> Application Load Balancer (invoke, HTTPS): Browse and search
  - satisfies: R2, R5
- WAF -> Application Load Balancer (other): Protects ALB
  - satisfies: I3
- Application Load Balancer -> Web API tasks (AZ1) (invoke, HTTP): Route to tasks
  - satisfies: R7, R10
- Application Load Balancer -> Web API tasks (AZ2) (invoke, HTTP): Route to tasks
  - satisfies: R7, R10
- Web API tasks (AZ1) -> Product cache (Valkey) (read, Redis): Cache-aside product reads
  - satisfies: R5, R9
- Web API tasks (AZ2) -> Product cache (Valkey) (read, Redis): Cache-aside product reads
  - satisfies: R5, R9
- Web API tasks (AZ1) -> Product database (RDS) (write, SQL): Cache misses and product writes
  - satisfies: R1, R5
- Web API tasks (AZ2) -> Product database (RDS) (write, SQL): Cache misses and product writes
  - satisfies: R1, R5
- Web API tasks (AZ1) -> Product search index (read, HTTPS): Search queries
  - satisfies: R2, R3, R4, R10
- Web API tasks (AZ2) -> Product search index (read, HTTPS): Search queries
  - satisfies: R2, R3, R4, R10
- Web API tasks (AZ1) -> Product change queue (write, HTTPS): Publish product-changed after commit (outbox-backed)
  - satisfies: R8, R6
- Web API tasks (AZ2) -> Product change queue (write, HTTPS): Publish product-changed after commit (outbox-backed)
  - satisfies: R8, R6
- Product change queue -> Indexer function (event): Trigger indexer (partial batch responses)
  - configuration deadLetterQueue: Indexing DLQ with redrive policy
  - satisfies: R6, R8, I1
- Indexer function -> Product database (RDS) (read, SQL): Load current product row
  - satisfies: R8, R1
- Indexer function -> Product search index (write, HTTPS): Idempotent upsert of document
  - satisfies: R6, R8, I2
- Indexer function -> Product cache (Valkey) (write, Redis): Invalidate cached product
  - satisfies: R5, R9
- Product change queue -> Indexing DLQ (other): Redrive after max receives
  - satisfies: I1
- Indexing DLQ -> CloudWatch (other): DLQ depth alarm
  - satisfies: I1
- Indexer function -> CloudWatch (write): Logs and metrics
  - satisfies: I1, R6
- Application Load Balancer -> ACM certificate (other): Uses certificate
  - satisfies: I3
- ECS cluster -> Web API tasks (AZ1) (other): Schedules tasks
  - satisfies: R7
- ECS cluster -> Web API tasks (AZ2) (other): Schedules tasks
  - satisfies: R7
- Customer managed key -> Product database (RDS) (other): Encryption key
  - satisfies: I3

---

## Scenario: nightly-reports-serverless

**User prompt**

> Every night at 02:00 we need to generate PDF sales reports from our existing Aurora PostgreSQL database, store them for a year, and email a download link to 40 regional managers. The job takes about 25 minutes. Keep it simple and cheap.

**Enabled priorities** (chosen by the user with one-click toggles)

- Prefer serverless and fully managed services over servers to manage.

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Generate PDF sales reports from the existing Aurora PostgreSQL database every night at 02:00.
- R2 [functional, confirmed] Store generated reports for one year.
- R3 [functional, confirmed] Email a download link to 40 regional managers after each report is generated.
- R4 [non-functional, inferred] The nightly job takes about 25 minutes, so it must run longer than a standard 15-minute Lambda timeout.
- R5 [constraint, confirmed] Keep the solution simple and low cost.
- R6 [constraint, confirmed] Use a serverless-first design.
- R7 [non-functional, inferred] Reports should be retrievable through secure download links that expire rather than public access.
- R8 [non-functional, inferred] Report generation must read from Aurora without affecting the database's availability for other workloads.
- T-serverless-first [non-functional, confirmed] Prefer serverless and fully managed services (Lambda, API Gateway, DynamoDB, Fargate, Step Functions) over servers to manage.
- I1 [functional, inferred] Failed or incomplete nightly runs must be detected, retried safely, and alerted to operators.
- I2 [non-functional, inferred] Each download token must be scoped to a single report and expire, so a leaked link exposes only that report for a limited time.

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-cloud]
  - Region (Region) [c-region]
    - VPC (VPC) [c-vpc]
      - Public subnet (Subnet, public) [c-sub-pub]
      - Private app subnet (Subnet, private) [c-sub-app]
      - Private database subnet (Subnet, private) [c-sub-db]

**Nodes**

- **Nightly schedule (02:00)** [n-schedule] - service: Amazon EventBridge
  - in container: Region
  - purpose: Starts the report job every night at 02:00.
  - rationale: A managed scheduler is serverless and cheap, and it needs no always-on component.
  - satisfies: R1, R5, R6, T-serverless-first
- **Report generation task** [n-job] - service: AWS Fargate
  - in container: Private app subnet
  - purpose: Queries Aurora, renders PDF reports, stores them in S3, and triggers the emails.
  - rationale: Fargate runs without servers and has no 15-minute limit, so it handles the 25-minute job that Lambda cannot.
  - satisfies: R1, R2, R3, R4, R5, R6, R8, I1, T-serverless-first
- **Aurora PostgreSQL (existing) reader** [n-aurora] - service: Amazon Aurora
  - in container: Private database subnet
  - purpose: Source of sales data for the reports.
  - rationale: The job reads from a reader instance so the writer instance and other workloads are not affected.
  - configuration backup: automated
  - configuration encryption: AWS-managed
  - satisfies: R1, R8
- **NAT gateway** [n-nat] - service: NAT Gateway
  - in container: Public subnet
  - purpose: Gives the private task outbound access to SES.
  - rationale: Private tasks need an outbound path to SES, and NAT is the simplest catalog option for it.
  - satisfies: R3, R5
- **Report bucket (private, 365-day lifecycle)** [n-reports] - service: Amazon S3
  - in container: Region
  - purpose: Stores the generated PDF reports for one year.
  - rationale: S3 is durable, cheap, and serverless, and lifecycle rules remove reports after one year.
  - configuration encryption: AWS-managed
  - satisfies: R2, R5, R6, R7, T-serverless-first
- **Amazon SES** [n-ses] - service: Amazon SES
  - in container: Region
  - purpose: Sends the download-link emails to managers.
  - rationale: SES is low cost and suits a small volume of about 40 emails per night.
  - satisfies: R3, R5
- **Regional managers (40)** [n-managers] - EXTERNAL user: Regional managers (40)
  - purpose: Receive the email and download their reports.
  - rationale: Managers are external users who access reports through emailed links.
  - satisfies: R3, R7
- **Download API (HTTP)** [n-api] - service: Amazon API Gateway
  - in container: Region
  - purpose: Public entry point for the report links.
  - rationale: An HTTP API is simple and low cost, and the Lambda authorizer protects it without WAF, which HTTP APIs do not support.
  - configuration apiType: HTTP
  - configuration authorizer: Lambda authorizer with signed expiring per-report token
  - satisfies: R5, R6, R7, I2
- **Token authorizer** [n-authz] - service: AWS Lambda
  - in container: Region
  - purpose: Checks that the download token is valid, unexpired, and scoped to the requested report.
  - rationale: A small Lambda authorizer is serverless and fits the token-based access without user logins.
  - satisfies: R7, I2, T-serverless-first
- **Download link handler** [n-download] - service: AWS Lambda
  - in container: Region
  - purpose: Issues a short-lived presigned S3 URL for the authorized report and redirects the manager to it.
  - rationale: Lambda is serverless and fast for this small request, and presigned URLs keep the bucket private.
  - satisfies: R7, I2, T-serverless-first
- **CloudWatch alarms and logs** [n-logs] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Monitors job runs, sends failure alarms, and records logs.
  - rationale: Failures in the nightly run must be alerted, and CloudWatch provides this with no extra infrastructure.
  - satisfies: R5, I1

**Edges**

- Nightly schedule (02:00) -> Report generation task (invoke, HTTPS): Start nightly run
  - satisfies: R1, R6
- Report generation task -> Aurora PostgreSQL (existing) reader (read, PostgreSQL): Read sales data from reader endpoint
  - satisfies: R1, R8
- Report generation task -> Report bucket (private, 365-day lifecycle) (write, HTTPS): Store PDF reports
  - satisfies: R2
- Report generation task -> Amazon SES (invoke, HTTPS): Send download-link emails via NAT
  - satisfies: R3
- Amazon SES -> Regional managers (40) (other, SMTP): Download-link email
  - satisfies: R3, R7
- Regional managers (40) -> Download API (HTTP) (invoke, HTTPS): Open download link
  - satisfies: R7, I2
- Download API (HTTP) -> Token authorizer (invoke, HTTPS): Verify token
  - satisfies: R7, I2
- Download API (HTTP) -> Download link handler (invoke, HTTPS): Request authorized report
  - satisfies: R7
- Download link handler -> Report bucket (private, 365-day lifecycle) (read, HTTPS): Create presigned URL for report
  - satisfies: R7, I2
- Report generation task -> CloudWatch alarms and logs (other, HTTPS): Job metrics and failure alarms
  - satisfies: I1, R5

### Design B

**Requirements**

- R1 [functional, confirmed] Run a nightly job at 02:00 that generates PDF sales reports from the existing Aurora PostgreSQL database
- R2 [functional, confirmed] Store generated PDF reports for one year
- R3 [functional, confirmed] Email a download link for each report to 40 regional managers
- R4 [constraint, inferred] Nightly job runs for about 25 minutes, which exceeds the 15-minute Lambda limit, so it needs a container or otherwise long-running compute
- R5 [non-functional, confirmed] Keep the solution simple and low cost
- R6 [non-functional, inferred] Read from Aurora PostgreSQL without disrupting the existing database, for example by using a read replica or off-peak access
- R7 [non-functional, inferred] Download links expire after a set period and report objects are not publicly accessible
- R8 [non-functional, inferred] Report generation failures are detected and surfaced so managers and operators are not left without reports
- T-serverless-first [non-functional, confirmed] Prefer serverless and fully managed services (Lambda, API Gateway, DynamoDB, Fargate, Step Functions) over servers to manage.
- I1 [non-functional, inferred] Operators must be alerted if the nightly run fails or does not start at 02:00, so a missing run is never silent
- I2 [non-functional, inferred] Report generation and email sending must be safe to retry so a rerun does not produce duplicate reports or duplicate emails to managers
- I3 [constraint, inferred] Report objects and Aurora data must be encrypted at rest and in transit

**Containers** (tree)

- AWS account (AWS Cloud) [aws-cloud]
  - Region (Region) [region]
    - VPC (VPC) [vpc]
      - Public subnet (Subnet, public) [subnet-public]
      - Private subnet (Subnet, private) [subnet-private]

**Nodes**

- **EventBridge schedule** [n-schedule] - service: Amazon EventBridge
  - in container: Region
  - purpose: Starts the nightly report job at 02:00
  - rationale: A managed scheduler triggers the job without any always-on component.
  - satisfies: R1, R5, T-serverless-first
- **Report generator task** [n-task] - service: AWS Fargate
  - in container: Public subnet
  - purpose: Runs for about 25 minutes to query Aurora, render PDFs, store them in S3 and send emails
  - rationale: Fargate supports jobs longer than the 15-minute Lambda limit without managing servers, and it is billed only while the task runs.
  - satisfies: R1, R2, R3, R4, R5, R6, R8, I2, T-serverless-first
- **Aurora PostgreSQL (existing)** [n-aurora] - service: Amazon Aurora
  - in container: Private subnet
  - purpose: Source of sales data for the reports
  - rationale: Existing database; the job reads from a reader instance so the primary is not disrupted.
  - configuration encryption: AWS-managed
  - satisfies: R1, R6
- **Report bucket** [n-s3] - service: Amazon S3
  - in container: Region
  - purpose: Stores generated PDF reports privately for one year
  - rationale: S3 is durable, cheap for archived files, and supports a lifecycle rule that deletes reports after 365 days and blocks public access.
  - configuration encryption: AWS-managed
  - satisfies: R2, R5, R7, I3
- **Amazon SES** [n-ses] - service: Amazon SES
  - in container: Region
  - purpose: Sends the email containing each presigned download link
  - rationale: SES is a low-cost managed email service that integrates with the workload in the same Region.
  - satisfies: R3, R5
- **CloudWatch** [n-cloudwatch] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Collects task logs and metrics and raises alarms on failed or missing runs
  - rationale: Native logging and alarms surface failures to operators without extra tooling.
  - satisfies: R8, I1
- **Operator alert topic** [n-sns] - service: Amazon SNS
  - in container: Region
  - purpose: Delivers failure and missing-run alarms to the operations team
  - rationale: SNS fans out alarm notifications to operator email or chat with no servers.
  - satisfies: R8, I1
- **Regional managers** [n-managers] - EXTERNAL user: Regional managers (40)
  - purpose: Receive the email and download reports with the presigned link
  - rationale: External recipients who access reports only through the emailed link, with no login portal.
  - satisfies: R3, R7
- **Operations team** [n-ops] - EXTERNAL user: Operations team
  - purpose: Receives alerts when a report run fails or does not start
  - rationale: Operators must be notified so a missed night of reports is fixed quickly.
  - satisfies: R8, I1

**Edges**

- EventBridge schedule -> Report generator task (invoke): Start nightly run at 02:00
  - satisfies: R1, R4
- Report generator task -> Aurora PostgreSQL (existing) (read, PostgreSQL): Read sales data from reader
  - satisfies: R1, R6
- Report generator task -> Report bucket (write, HTTPS): Store PDF reports
  - satisfies: R2, R7, I3
- Report generator task -> Amazon SES (invoke, HTTPS): Send email with presigned link
  - satisfies: R3, I2
- Amazon SES -> Regional managers (other, SMTP): Deliver download email
  - satisfies: R3, R7
- Regional managers -> Report bucket (read, HTTPS): Download report via presigned link
  - satisfies: R7
- Report generator task -> CloudWatch (write, HTTPS): Send logs and metrics
  - satisfies: R8
- CloudWatch -> Operator alert topic (event): Alarm on failed or missing run
  - satisfies: R8, I1
- Operator alert topic -> Operations team (other, email): Alert operators
  - satisfies: R8, I1

---

## Scenario: regulated-portal

**User prompt**

> A regional bank needs a customer self-service portal (web app plus API). Requirements: protection against common web exploits and DDoS, TLS everywhere, all data encrypted at rest with keys we control, a full audit trail of administrative API activity in the AWS account, and customer sign-in with MFA. The app tier runs in containers in private subnets.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Customer self-service portal delivered as a web app plus API
- R2 [non-functional, confirmed] Protection against common web exploits
- R3 [non-functional, confirmed] Protection against DDoS attacks
- R4 [constraint, confirmed] TLS everywhere for data in transit
- R5 [constraint, confirmed] All data encrypted at rest with customer-controlled keys
- R6 [constraint, confirmed] Full audit trail of administrative API activity in the AWS account
- R7 [functional, confirmed] Customer sign-in with multi-factor authentication (MFA)
- R8 [constraint, confirmed] Application tier runs in containers in private subnets
- R9 [constraint, inferred] Regulated regional bank workload requires strong access control and logging of all changes
- R10 [non-functional, inferred] Only the web and API entry points are exposed publicly; backend resources are not directly reachable from the internet
- R11 [non-functional, inferred] Secrets and encryption keys are managed centrally with rotation and restricted access
- R12 [non-functional, inferred] Security events and access logs are retained and monitored for investigation
- I1 [non-functional, inferred] Point-in-time recovery and versioned backups for all customer and audit data so records can be restored after corruption or deletion
- I2 [constraint, inferred] Least-privilege IAM roles for container tasks and administrators, with separation of duties for key administration

**Containers** (tree)

- AWS account (AWS Cloud) [c-aws]
  - Single Region (Region) [c-region]
    - Portal VPC (VPC) [c-vpc]
      - Availability Zone A (Availability Zone) [c-az-a]
        - Public subnet A (Subnet, public) [c-pub-a]
        - Private app and data subnet A (Subnet, private) [c-priv-a]
      - Availability Zone B (Availability Zone) [c-az-b]
        - Public subnet B (Subnet, public) [c-pub-b]
        - Private app and data subnet B (Subnet, private) [c-priv-b]

**Nodes**

- **Customer** [n-customer] - EXTERNAL user: Customer browser or app
  - purpose: Uses the self-service portal and API
  - rationale: Client entry point outside the AWS account
  - satisfies: R1, R4, R7
- **CloudFront distribution** [n-cloudfront] - service: Amazon CloudFront
  - purpose: Single public entry point for web app and API with TLS termination
  - rationale: Terminates TLS at the edge and routes web content to S3 and API calls to the ALB
  - satisfies: R1, R2, R3, R4, R10
- **AWS Shield** [n-shield] - service: AWS Shield
  - purpose: DDoS protection for public endpoints
  - rationale: Standard DDoS protection for CloudFront and the ALB
  - satisfies: R3
- **AWS WAF** [n-waf] - service: AWS WAF
  - purpose: Blocks common web exploits on the API entry point
  - rationale: Managed rule sets filter common exploits before requests reach the application tier
  - satisfies: R2, R10
- **ACM certificates** [n-acm] - service: AWS Certificate Manager
  - purpose: Manages public TLS certificates
  - rationale: Provides and renews certificates for HTTPS at CloudFront and the ALB
  - satisfies: R4
- **Web app bucket** [n-web] - service: Amazon S3
  - purpose: Stores the static web application
  - rationale: Private bucket served only through CloudFront with OAC; versioning allows recovery of deployed assets
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R1, R5, R10, I1
- **Application Load Balancer** [n-alb] - service: Application Load Balancer
  - purpose: Routes API requests to the container tasks over HTTPS
  - rationale: Spans two Availability Zones and is the only public route to the private application tier
  - satisfies: R1, R4, R8, R10
- **Cognito user pool** [n-cognito] - service: Amazon Cognito
  - purpose: Customer sign-in with MFA
  - rationale: Managed identity with MFA enforcement and token issuance for the API
  - satisfies: R7, I2
- **Portal API containers** [n-fargate] - service: AWS Fargate
  - purpose: Runs the portal API in containers in private subnets
  - rationale: Serverless containers in private subnets with no servers to patch; task roles give least-privilege access
  - satisfies: R1, R8, R9, I2
- **Aurora customer database** [n-aurora] - service: Amazon Aurora
  - purpose: Stores customer and account data
  - rationale: Relational store with Multi-AZ replicas, encryption with customer keys, and automated backups
  - configuration encryption: KMS
  - configuration multiAz: replicas in two Availability Zones
  - configuration backup: automated
  - satisfies: R5, R9, I1
- **Secrets Manager** [n-secrets] - service: AWS Secrets Manager
  - purpose: Stores database credentials and API secrets with rotation
  - rationale: Central secret storage with rotation and restricted access
  - satisfies: R11
- **KMS customer-managed keys** [n-kms] - service: AWS KMS
  - purpose: Holds the bank's keys for encryption at rest
  - rationale: Bank administers key policies, rotation and access
  - satisfies: R5, R11
- **Audit log bucket** [n-audit-bucket] - service: Amazon S3
  - purpose: Stores CloudTrail logs for retention
  - rationale: Encrypted with customer keys and versioned to keep an immutable-style audit history
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R6, R12, I1
- **CloudTrail trail** [n-cloudtrail] - service: AWS CloudTrail
  - purpose: Records administrative API activity in the account
  - rationale: Management event logging supports investigation and regulatory audit
  - satisfies: R6, R9
- **CloudWatch** [n-cloudwatch] - service: Amazon CloudWatch
  - purpose: Collects application logs, metrics and security alarms
  - rationale: Central monitoring and retained access logs for investigation
  - satisfies: R9, R12
- **IAM roles and policies** [n-iam] - service: AWS IAM
  - purpose: Controls access to AWS resources and admin actions
  - rationale: Least-privilege roles for tasks and administrators
  - satisfies: R9, I2

**Edges**

- Customer -> CloudFront distribution (invoke, HTTPS): Web and API requests
  - satisfies: R1, R4
- Customer -> Cognito user pool (invoke, HTTPS): Sign-in with MFA
  - satisfies: R7
- CloudFront distribution -> Web app bucket (origin, HTTPS): Web app origin
  - configuration originAccess: OAC
  - satisfies: R1, R10
- CloudFront distribution -> Application Load Balancer (origin, HTTPS): API origin
  - satisfies: R1, R4, R10
- AWS WAF -> Application Load Balancer (other): Protects API entry point
  - satisfies: R2, R10
- Application Load Balancer -> Portal API containers (invoke, HTTPS): Forwarded API requests
  - satisfies: R1, R8, R4
- Portal API containers -> Aurora customer database (read, TLS): Customer data queries
  - satisfies: R5, R4
- Portal API containers -> Secrets Manager (read, HTTPS): Fetch credentials
  - satisfies: R11
- Portal API containers -> CloudWatch (other, HTTPS): Application and access logs
  - satisfies: R9, R12
- CloudTrail trail -> Audit log bucket (write, HTTPS): Deliver audit logs
  - satisfies: R6, R12

### Design B

**Requirements**

- R1 [functional, confirmed] Customer self-service portal consisting of a web app and an API
- R2 [functional, confirmed] Customer sign-in with multi-factor authentication (MFA)
- R3 [non-functional, confirmed] Protection against common web exploits
- R4 [non-functional, confirmed] Protection against DDoS attacks
- R5 [constraint, confirmed] TLS everywhere for data in transit
- R6 [constraint, confirmed] All data encrypted at rest with customer-controlled keys
- R7 [constraint, confirmed] Full audit trail of administrative API activity in the AWS account
- R8 [constraint, confirmed] Application tier runs in containers in private subnets
- R9 [constraint, inferred] Regional bank operating environment with financial-services security expectations
- R10 [non-functional, inferred] Centralized logging and monitoring of application and security events
- R11 [non-functional, inferred] Least-privilege access control for administrative and workload identities
- R12 [non-functional, inferred] Secrets such as credentials and API keys stored and rotated securely
- I1 [non-functional, inferred] Application tier and load balancer span two Availability Zones for availability
- I2 [functional, inferred] Containers in private subnets need outbound access to AWS APIs and external services without public IPs
- I3 [functional, inferred] Static web assets are served privately from S3 through CloudFront
- I4 [non-functional, inferred] Audit logs are stored durably in encrypted S3 with versioning

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Home Region (Region) [region]
    - Portal VPC (VPC) [vpc]
      - AZ A (Availability Zone) [azA]
        - Public subnet A (Subnet, public) [pubA]
        - App private subnet A (Subnet, private) [appA]
        - Data private subnet A (Subnet, private) [dbA]
      - AZ B (Availability Zone) [azB]
        - Public subnet B (Subnet, public) [pubB]
        - App private subnet B (Subnet, private) [appB]
        - Data private subnet B (Subnet, private) [dbB]

**Nodes**

- **Customer browser** [customer] - EXTERNAL user: Bank customer
  - purpose: Uses the portal
  - rationale: Client of the portal
  - satisfies: R1
- **Route 53** [r53] - service: Amazon Route 53
  - purpose: DNS for the portal domain
  - rationale: Routes customers to CloudFront
  - satisfies: R1
- **CloudFront** [cf] - service: Amazon CloudFront
  - purpose: Single public entry point for web and API, TLS termination
  - rationale: Edge TLS, caching of static assets, and a place to attach WAF and DDoS protection
  - satisfies: R1, R4, R5, I3
- **Shield** [shield] - service: AWS Shield
  - purpose: DDoS protection for CloudFront and Route 53
  - rationale: Meets DDoS protection requirement
  - satisfies: R4, R9
- **WAF** [waf] - service: AWS WAF
  - purpose: Managed rules against common web exploits
  - rationale: Blocks OWASP-style attacks at the edge
  - satisfies: R3, R9
- **ACM certificates** [acm] - service: AWS Certificate Manager
  - purpose: TLS certificates for CloudFront and ALB
  - rationale: Managed, auto-renewing certificates for TLS everywhere
  - satisfies: R5
- **Web assets bucket** [web] - service: Amazon S3
  - purpose: Hosts static web app
  - rationale: Private bucket served via CloudFront OAC, encrypted with customer managed key
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R1, R6, I3
- **Cognito user pool** [cognito] - service: Amazon Cognito
  - purpose: Customer sign-in with mandatory MFA
  - rationale: Managed authentication with MFA
  - satisfies: R2, R1
- **Application Load Balancer** [alb] - service: Application Load Balancer
  - purpose: HTTPS ingress to containers
  - rationale: Controlled ingress across two AZs; HTTPS listener with ACM cert
  - configuration encryption: KMS
  - satisfies: R1, R5, R8, I1
- **NAT Gateway** [nat] - service: NAT Gateway
  - purpose: Outbound access for private tasks
  - rationale: Lets private containers reach AWS APIs without public IPs
  - satisfies: I2, R8
- **ECS cluster** [ecs] - service: Amazon ECS
  - purpose: Orchestrates the API containers
  - rationale: Container orchestration without managing servers when used with Fargate
  - satisfies: R8, R1
- **API service on Fargate** [fargate] - service: AWS Fargate
  - purpose: Runs the API containers in private subnets across two AZs
  - rationale: Serverless containers in private subnets
  - satisfies: R1, R8, I1
- **Aurora cluster** [aurora] - service: Amazon Aurora
  - purpose: Stores customer data
  - rationale: Relational store in private subnets, encrypted with KMS, Multi-AZ, automated backups
  - configuration encryption: KMS
  - configuration multiAz: replicas in two AZs
  - configuration backup: automated backups
  - satisfies: R1, R6, R9, I1
- **KMS customer managed keys** [kms] - service: AWS KMS
  - purpose: Bank-controlled keys for all data at rest
  - rationale: Key policy, rotation and deletion controlled by the bank
  - satisfies: R6, R9
- **Secrets Manager** [secrets] - service: AWS Secrets Manager
  - purpose: Stores and rotates DB credentials and API keys
  - rationale: Secure rotation of secrets
  - satisfies: R12
- **IAM** [iam] - service: AWS IAM
  - purpose: Least-privilege roles for tasks and administrators
  - rationale: Scoped task roles and admin roles
  - satisfies: R11
- **CloudTrail** [trail] - service: AWS CloudTrail
  - purpose: Audit trail of AWS control-plane API activity
  - rationale: Records administrative API calls across the account
  - satisfies: R7, R9
- **Audit log bucket** [auditbucket] - service: Amazon S3
  - purpose: Durable storage of CloudTrail logs
  - rationale: Encrypted with customer managed key and versioned
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R7, R6, I4
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - purpose: Logs, metrics and alarms for application and security events
  - rationale: Centralized monitoring
  - satisfies: R10

**Edges**

- Customer browser -> Route 53 (invoke, DNS): Resolve portal domain
  - satisfies: R1
- Customer browser -> CloudFront (invoke, HTTPS): Web and API requests
  - satisfies: R1, R5
- WAF -> CloudFront (other): Protects distribution
  - satisfies: R3
- Shield -> CloudFront (other): DDoS protection
  - satisfies: R4
- CloudFront -> Web assets bucket (origin, HTTPS): Static assets origin
  - configuration originAccess: OAC
  - satisfies: R1, I3
- CloudFront -> Application Load Balancer (origin, HTTPS): API origin
  - satisfies: R1, R5
- Application Load Balancer -> API service on Fargate (invoke, HTTPS): Forward to tasks
  - satisfies: R5, R8
- API service on Fargate -> Cognito user pool (invoke, HTTPS): Validate tokens
  - satisfies: R2
- API service on Fargate -> Aurora cluster (write, TLS): Read and write data
  - satisfies: R1, R5
- API service on Fargate -> Secrets Manager (read, HTTPS): Fetch secrets
  - satisfies: R12
- API service on Fargate -> NAT Gateway (other, HTTPS): Outbound traffic
  - satisfies: I2
- ECS cluster -> API service on Fargate (other): Schedules tasks
  - satisfies: R8
- ACM certificates -> CloudFront (other): Certificate
  - satisfies: R5
- ACM certificates -> Application Load Balancer (other): Certificate
  - satisfies: R5
- KMS customer managed keys -> Aurora cluster (other): Encrypts data
  - satisfies: R6
- KMS customer managed keys -> Web assets bucket (other): Encrypts objects
  - satisfies: R6
- KMS customer managed keys -> Audit log bucket (other): Encrypts logs
  - satisfies: R6, R7
- KMS customer managed keys -> Secrets Manager (other): Encrypts secrets
  - satisfies: R6, R12
- Secrets Manager -> Aurora cluster (other): Rotates DB credentials
  - satisfies: R12
- CloudTrail -> Audit log bucket (write, HTTPS): Deliver audit logs
  - satisfies: R7, I4
- CloudTrail -> CloudWatch (write, HTTPS): Send audit events
  - satisfies: R7, R10
- API service on Fargate -> CloudWatch (write, HTTPS): Application logs and metrics
  - satisfies: R10
- IAM -> API service on Fargate (other): Task roles
  - satisfies: R11
- Route 53 -> CloudFront (other, DNS): Alias to distribution
  - satisfies: R1
