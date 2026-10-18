# Review packet, group 1

Scenarios in this packet: regulated-portal-security, myblog, saas-containers-multi-az. Read `reviewer-instructions.md` for the task and the output format.

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

## Scenario: regulated-portal-security

**User prompt**

> A regional bank needs a customer self-service portal (web app plus API). Requirements: protection against common web exploits and DDoS, TLS everywhere, all data encrypted at rest with keys we control, a full audit trail of administrative API activity in the AWS account, and customer sign-in with MFA. The app tier runs in containers in private subnets.

**Enabled priorities** (chosen by the user with one-click toggles)

- Harden security: WAF on public entry points, KMS encryption at rest, private subnets for data, authenticated access on every public interface.

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Customer self-service portal delivered as a web app plus API
- R2 [functional, confirmed] Customer sign-in with MFA
- R3 [non-functional, confirmed] Protection against common web exploits and DDoS attacks
- R4 [non-functional, confirmed] TLS everywhere for data in transit
- R5 [constraint, confirmed] All data encrypted at rest with customer-controlled keys
- R6 [constraint, confirmed] Full audit trail of administrative API activity in the AWS account
- R7 [constraint, confirmed] Application tier runs in containers in private subnets
- R8 [constraint, inferred] Regional bank operating context requires strong access control and secure handling of customer financial data
- R9 [non-functional, inferred] Web and API tiers should scale to handle customer traffic peaks
- R10 [non-functional, inferred] Logs and audit records retained for investigation and compliance review
- C-auth-methods [functional, inferred] Which MFA and sign-in methods should customers use? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected number of customers and peak concurrent users? (decided by the architect)
- C-data-retention [functional, inferred] How long must customer transaction data, session data, and audit logs be retained? (decided by the architect)
- T-security [non-functional, confirmed] Harden security: WAF on public entry points, KMS encryption at rest, private subnets for data, authenticated access on every public interface.
- I1 [non-functional, inferred] Audit records must be tamper-evident, with log file integrity validation and restricted deletion, so investigators can rely on them
- I2 [non-functional, inferred] Customer sessions must expire after inactivity and be revocable, limiting exposure of financial data on shared devices

**Containers** (tree)

- AWS Account (AWS Cloud) [c-aws]
  - Region (Region) [c-region]
    - Portal VPC (VPC) [c-vpc]
      - AZ A (Availability Zone) [c-az-a]
        - Public subnet A (Subnet, public) [c-pub-a]
        - Private app subnet A (Subnet, private) [c-app-a]
        - Private data subnet A (Subnet, private) [c-data-a]
      - AZ B (Availability Zone) [c-az-b]
        - Public subnet B (Subnet, public) [c-pub-b]
        - Private app subnet B (Subnet, private) [c-app-b]
        - Private data subnet B (Subnet, private) [c-data-b]

**Nodes**

- **Customers** [n-customers] - EXTERNAL user: Bank customers
  - purpose: Retail and business customers using the self-service portal in a browser
  - rationale: Source of all portal traffic; sign-in requires MFA
  - satisfies: R1, R2
- **Route 53** [n-route53] - service: Amazon Route 53
  - purpose: DNS for the portal domain
  - rationale: Resolves the portal hostname to the public ALB over HTTPS
  - satisfies: R1, R4
- **Shield** [n-shield] - service: AWS Shield
  - purpose: DDoS protection for public entry points
  - rationale: Shield Standard protects the ALB against network and transport layer DDoS attacks
  - satisfies: R3, T-security
- **WAF** [n-waf] - service: AWS WAF
  - purpose: Web application firewall with managed rule sets
  - rationale: Blocks common web exploits (OWASP-style) on the public entry point; attached to the ALB because API Gateway HTTP APIs cannot use WAF
  - satisfies: R3, T-security
- **Certificate Manager** [n-acm] - service: AWS Certificate Manager
  - purpose: Public TLS certificate for the portal domain
  - rationale: Provides the certificate the ALB uses for TLS termination, so data is encrypted in transit
  - satisfies: R4
- **Application Load Balancer** [n-alb] - service: Application Load Balancer
  - purpose: Single public entry point for the web app and API
  - rationale: Terminates HTTPS, performs OIDC sign-in with Cognito, and routes to Fargate tasks; spans two AZs
  - satisfies: R1, R2, R4, R9, C-user-scale, T-security
- **NAT Gateway** [n-nat] - service: NAT Gateway
  - purpose: Outbound internet access for private tasks
  - rationale: Lets private Fargate tasks reach AWS service endpoints for Cognito and Secrets Manager without public IPs
  - satisfies: R7
- **Fargate Portal Tasks** [n-fargate] - service: AWS Fargate
  - purpose: Containerised web app and API backend
  - rationale: Serverless containers in private subnets; auto scaling absorbs customer traffic peaks
  - satisfies: R1, R7, R9, C-user-scale, T-security
- **Cognito User Pool** [n-cognito] - service: Amazon Cognito
  - purpose: Customer sign-in with TOTP MFA and session management
  - rationale: Managed authentication with MFA and token expiry meets the customer sign-in and session timeout needs
  - satisfies: R2, I2, C-auth-methods, T-security
- **Aurora Customer Database** [n-aurora] - service: Amazon Aurora
  - purpose: Relational store for customer accounts and transactions
  - rationale: Encrypted with a customer managed key, Multi-AZ replicas, and point-in-time restore for financial records
  - configuration encryption: KMS
  - configuration multiAz: enabled
  - configuration backup: automated
  - satisfies: R5, R8, R10, C-data-retention, T-security
- **Secrets Manager** [n-secrets] - service: AWS Secrets Manager
  - purpose: Stores database credentials and app secrets
  - rationale: Keeps credentials out of code and encrypts them with KMS
  - satisfies: R5, R8
- **KMS Customer Managed Keys** [n-kms] - service: AWS KMS
  - purpose: Customer-controlled encryption keys for data at rest
  - rationale: Bank-controlled keys satisfy the requirement that all data is encrypted with keys the bank controls
  - satisfies: R5, T-security
- **IAM** [n-iam] - service: AWS IAM
  - purpose: Access control for services, operators and key policies
  - rationale: Least-privilege roles for tasks and operators support strong access control
  - satisfies: R8, I1
- **Audit Log Archive** [n-s3-logs] - service: Amazon S3
  - purpose: Long-term storage for CloudTrail and access logs
  - rationale: Versioned, KMS-encrypted bucket with lifecycle retention for compliance review
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R5, R6, R10, I1, C-data-retention
- **CloudTrail** [n-cloudtrail] - service: AWS CloudTrail
  - purpose: Records administrative API activity across the account
  - rationale: Full audit trail of administrative API calls, with log file validation for integrity
  - satisfies: R6, R10, I1
- **CloudWatch** [n-cloudwatch] - service: Amazon CloudWatch
  - purpose: Metrics, logs and alarms for the portal
  - rationale: Collects application logs and scaling metrics and raises alarms; retains logs for investigation
  - satisfies: R9, R10, C-data-retention

**Edges**

- Customers -> Route 53 (invoke, DNS): Resolve portal domain
  - satisfies: R1
- Customers -> Application Load Balancer (invoke, HTTPS): Web and API requests over TLS
  - satisfies: R1, R3, R4
- WAF -> Application Load Balancer (other): Inspects requests
  - satisfies: R3, T-security
- Shield -> Application Load Balancer (other): DDoS protection
  - satisfies: R3
- Certificate Manager -> Application Load Balancer (other): TLS certificate
  - satisfies: R4
- Application Load Balancer -> Cognito User Pool (invoke, OIDC): Authenticate customer with MFA
  - satisfies: R2, C-auth-methods
- Application Load Balancer -> Fargate Portal Tasks (invoke, HTTP): Forward authenticated requests
  - satisfies: R1, R7, R9
- Fargate Portal Tasks -> Aurora Customer Database (write, TLS): Read and write customer data
  - satisfies: R5, R8, R4
- Fargate Portal Tasks -> Secrets Manager (read, HTTPS): Read credentials
  - satisfies: R5, R8
- Fargate Portal Tasks -> NAT Gateway (other): Outbound via NAT
  - satisfies: R7
- Fargate Portal Tasks -> CloudWatch (write, HTTPS): Application logs
  - satisfies: R10
- CloudTrail -> Audit Log Archive (write, HTTPS): Deliver audit trail
  - satisfies: R6, R10, I1
- KMS Customer Managed Keys -> Aurora Customer Database (other): Data encryption key
  - satisfies: R5
- KMS Customer Managed Keys -> Audit Log Archive (other): Log encryption key
  - satisfies: R5
- KMS Customer Managed Keys -> Secrets Manager (other): Secret encryption key
  - satisfies: R5

### Design B

**Requirements**

- R1 [functional, confirmed] Customer self-service portal delivered as a web app plus API
- R2 [functional, confirmed] Customer sign-in with MFA
- R3 [non-functional, confirmed] Protection against common web exploits and DDoS
- R4 [non-functional, confirmed] TLS everywhere in transit
- R5 [constraint, confirmed] All data encrypted at rest with customer-controlled keys
- R6 [constraint, confirmed] Full audit trail of administrative API activity in the AWS account
- R7 [constraint, confirmed] Application tier runs in containers in private subnets
- R8 [constraint, inferred] Workloads and data stay within the bank's regional footprint
- R9 [non-functional, inferred] Centralized logging and monitoring of application and API activity
- R10 [constraint, inferred] Least-privilege access control for administrative and service identities
- R11 [non-functional, inferred] Highly available deployment across multiple availability zones
- C-auth-methods [functional, inferred] Which MFA and sign-in methods should customers use? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected number of customers and peak concurrent sign-ins? (decided by the architect)
- C-data-retention [functional, inferred] How long must customer records and audit logs be retained, and should older data be archived? (decided by the architect)
- T-security [non-functional, confirmed] Harden security: WAF on public entry points, KMS encryption at rest, private subnets for data, authenticated access on every public interface.
- I1 [constraint, inferred] Retain customer records and CloudTrail audit logs for the bank's record-keeping period, archiving older audit logs to lower-cost storage
- I2 [non-functional, inferred] Point-in-time recovery and automated backups for the customer database
- I3 [non-functional, inferred] Alarms on failed sign-ins, WAF blocks and 5xx errors so operations can respond

**Containers** (tree)

- AWS account (AWS Cloud) [c-root]
  - Bank region (Region) [c-region]
    - Portal VPC (VPC) [c-vpc]
      - Availability Zone A (Availability Zone) [c-az-a]
        - Public subnet A (Subnet, public) [c-pub-a]
        - Private app subnet A (Subnet, private) [c-priv-a]
        - Private data subnet A (Subnet, private) [c-data-a]
      - Availability Zone B (Availability Zone) [c-az-b]
        - Public subnet B (Subnet, public) [c-pub-b]
        - Private app subnet B (Subnet, private) [c-priv-b]
        - Private data subnet B (Subnet, private) [c-data-b]

**Nodes**

- **Amazon Route 53** [n-route53] - service: Amazon Route 53
  - purpose: Public DNS for the portal domain
  - rationale: Resolves the portal domain to the load balancer over a managed, highly available DNS service.
  - satisfies: R1, R4
- **AWS Shield** [n-shield] - service: AWS Shield
  - purpose: DDoS protection for public endpoints
  - rationale: Standard protection is automatic for the internet-facing ALB, and the bank's DDoS requirement is met at the edge.
  - satisfies: R3, T-security
- **AWS WAF** [n-waf] - service: AWS WAF
  - purpose: Blocks common web exploits with managed rule groups and rate-limits abusive clients
  - rationale: Protects the public ALB entry point against OWASP-class attacks as required by the security priority.
  - satisfies: R3, R8, T-security
- **AWS Certificate Manager** [n-acm] - service: AWS Certificate Manager
  - purpose: TLS certificate for the portal domain
  - rationale: Provides and renews the public certificate used by the ALB HTTPS listener.
  - satisfies: R4
- **Application Load Balancer** [n-alb] - service: Application Load Balancer
  - purpose: Public HTTPS entry point that authenticates customers with Cognito before forwarding traffic
  - rationale: The only internet-facing component so containers stay private. An ALB needs subnets in two Availability Zones, which the design provides.
  - satisfies: R1, R3, R4, R7, R11, C-user-scale
- **Amazon Cognito user pool** [n-cognito] - service: Amazon Cognito
  - purpose: Customer sign-in with enforced MFA
  - rationale: Managed customer identity with MFA enforcement, integrated with the ALB authentication action.
  - satisfies: R2, R8, R10, C-auth-methods, C-user-scale
- **Fargate web and API tasks** [n-fargate] - service: AWS Fargate
  - purpose: Runs the portal web app and API as containers in private subnets across two Availability Zones
  - rationale: Serverless containers avoid host management, and tasks have no public IPs.
  - satisfies: R1, R7, R8, R11, C-user-scale
- **NAT Gateway** [n-nat] - service: NAT Gateway
  - purpose: Outbound access for tasks to Cognito and AWS APIs
  - rationale: Lets private tasks reach AWS endpoints without public addresses.
  - satisfies: R7, R8, R11
- **Aurora customer database** [n-aurora] - service: Amazon Aurora
  - purpose: Relational store for customer records with a Multi-AZ writer and reader
  - rationale: Multi-AZ replicas give automatic failover, and KMS encryption with automated backups meet the data requirements.
  - configuration backup: automated
  - configuration multiAz: 2 AZs
  - configuration encryption: KMS
  - satisfies: R1, R5, R7, R8, R11, I2, T-security, C-user-scale, C-data-retention
- **Secrets Manager** [n-secrets] - service: AWS Secrets Manager
  - purpose: Holds database credentials that are rotated and retrieved by tasks
  - rationale: Keeps credentials out of code and images, with access limited by IAM.
  - satisfies: R5, R10
- **AWS KMS customer managed keys** [n-kms] - service: AWS KMS
  - purpose: Bank-controlled keys for database, audit archive and secrets encryption
  - rationale: Keys are controlled by the bank through key policies and rotation.
  - satisfies: R5, R8, T-security
- **IAM roles and policies** [n-iam] - service: AWS IAM
  - purpose: Least-privilege roles for tasks, administrators and CloudTrail
  - rationale: Separate task and administrator roles limit access to what each identity needs.
  - satisfies: R10
- **AWS CloudTrail trail** [n-cloudtrail] - service: AWS CloudTrail
  - purpose: Records administrative API activity across the account
  - rationale: Management events trail provides the full audit trail, delivered to the archive bucket.
  - satisfies: R6, R8, I1, C-data-retention
- **Audit log archive bucket** [n-audit-s3] - service: Amazon S3
  - purpose: Stores CloudTrail logs with retention and lifecycle archiving
  - rationale: Versioned, KMS-encrypted and non-public, with lifecycle rules that move older logs to archive storage.
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R5, R6, R8, I1, C-data-retention
- **Amazon CloudWatch** [n-cloudwatch] - service: Amazon CloudWatch
  - purpose: Central logs, metrics and alarms for ALB, tasks and WAF
  - rationale: Single place for application and API activity, with alarms on failures and blocks.
  - satisfies: R8, R9, I3

**Edges**

- Amazon Route 53 -> Application Load Balancer (invoke, HTTPS): Portal DNS to ALB
  - satisfies: R1, R4
- AWS Shield -> Application Load Balancer (other): DDoS protection
  - satisfies: R3
- AWS WAF -> Application Load Balancer (other): Inspects requests before ALB
  - satisfies: R3, T-security
- AWS Certificate Manager -> Application Load Balancer (other): TLS certificate
  - satisfies: R4
- Application Load Balancer -> Amazon Cognito user pool (invoke, HTTPS): Authenticate customer with MFA
  - satisfies: R2, R10, C-auth-methods
- Application Load Balancer -> Fargate web and API tasks (invoke, HTTPS): Forward authenticated requests
  - satisfies: R1, R4, R7, R11, C-user-scale
- Fargate web and API tasks -> Aurora customer database (other, TLS): SQL queries over TLS
  - satisfies: R1, R4
- Fargate web and API tasks -> Secrets Manager (read, HTTPS): Retrieve database credentials
  - satisfies: R10, R5
- Fargate web and API tasks -> NAT Gateway (other): Outbound egress
  - satisfies: R7
- Fargate web and API tasks -> Amazon CloudWatch (other, HTTPS): Application logs
  - satisfies: R9
- Application Load Balancer -> Amazon CloudWatch (other): Access logs and metrics
  - satisfies: R9, I3
- AWS CloudTrail trail -> Audit log archive bucket (write, HTTPS): Deliver management event logs
  - satisfies: R6, I1, C-data-retention
- AWS CloudTrail trail -> Amazon CloudWatch (other): Trail events for alarms
  - satisfies: R6, R9
- Aurora customer database -> AWS KMS customer managed keys (other): Customer managed key
  - satisfies: R5
- Audit log archive bucket -> AWS KMS customer managed keys (other): Bucket encryption key
  - satisfies: R5

---

## Scenario: myblog

**User prompt**

> We need a serverless global blog. Traffic is read-heavy with infrequent writes. Static site plus a REST API, with caching. New subscribers get a welcome email. Authors upload photos and we need thumbnails. Keep latency and cost low.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Serverless global blog
- R2 [non-functional, confirmed] Traffic is read-heavy with infrequent writes
- R3 [functional, confirmed] Serve a static site plus a REST API
- R4 [non-functional, confirmed] Use caching to reduce read load and latency
- R5 [functional, confirmed] Send a welcome email to new subscribers
- R6 [functional, confirmed] Authors can upload photos
- R7 [functional, confirmed] Generate thumbnails for uploaded photos
- R8 [non-functional, confirmed] Keep latency low for a global audience
- R9 [constraint, confirmed] Keep cost low
- R10 [non-functional, inferred] Serve content globally with low latency at the edge
- R11 [non-functional, inferred] Scale automatically with traffic without managing servers
- R12 [functional, inferred] Store and serve uploaded images and thumbnails durably
- R13 [functional, inferred] Allow authors to write and manage blog posts through the API
- R14 [functional, inferred] Maintain a subscriber list for welcome emails
- R15 [non-functional, inferred] Protect write endpoints and uploads from unauthorized access
- C-auth-methods [functional, inferred] How should authors sign in to write posts and upload photos? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected number of readers and subscribers, and peak requests per second? (decided by the architect)
- C-notifications [functional, inferred] Beyond the welcome email, should subscribers receive emails when new posts are published? (decided by the architect)
- I1 [non-functional, inferred] Thumbnail and email processing must be retried on failure, be idempotent, and failures must be visible via alarms
- I2 [non-functional, inferred] Data at rest must be encrypted and posts and subscribers must be recoverable

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Primary Region (Region) [region]

**Nodes**

- **Readers** [readers] - EXTERNAL user: Readers and subscribers
  - purpose: Browse the blog and subscribe
  - rationale: Global anonymous audience
  - satisfies: R1, R2, R8
- **Authors** [authors] - EXTERNAL client-app: Author browser app
  - purpose: Sign in, write posts and upload photos
  - rationale: Authors manage content through the API
  - satisfies: R6, R13, R15
- **CloudFront** [cf] - service: Amazon CloudFront
  - purpose: Serves static site, images and cached API responses at the edge
  - rationale: Edge caching gives low latency globally and reduces origin load and cost
  - satisfies: R1, R2, R3, R4, R8, R9, R10, R11
- **WAF** [waf] - service: AWS WAF
  - purpose: Filters and rate-limits requests to the REST API
  - rationale: Protects the public API and subscribe endpoint; WAF works with REST API stages
  - satisfies: R15, R3
- **Site and media bucket** [site] - service: Amazon S3
  - purpose: Holds the static site, uploaded photos and thumbnails
  - rationale: Durable low-cost object storage; private and served via CloudFront OAC
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R3, R6, R7, R12, R9, I2
- **Cognito user pool** [cognito] - service: Amazon Cognito
  - purpose: Authenticates authors
  - rationale: Managed sign-in with tokens for API authorization
  - satisfies: R15, R13
- **REST API** [apigw] - service: Amazon API Gateway
  - purpose: Blog API for reading posts, managing posts, subscribing and requesting upload URLs
  - rationale: REST API is required for WAF and supports Cognito authorizers and caching
  - configuration apiType: REST
  - configuration authorizer: Cognito user pool for write and upload routes
  - satisfies: R3, R13, R14, R15, R4
- **API handler** [apifn] - service: AWS Lambda
  - purpose: Implements post CRUD, subscribe and presigned upload URL generation
  - rationale: Serverless compute that scales with traffic at low cost
  - satisfies: R3, R11, R13, R14, R6, R9
- **Posts table** [posts] - service: Amazon DynamoDB
  - purpose: Stores blog posts
  - rationale: On-demand key-value store suits read-heavy low-write workload
  - configuration encryption: KMS
  - configuration backup: PITR
  - satisfies: R2, R13, R11, R9, I2
- **Subscribers table** [subs] - service: Amazon DynamoDB
  - purpose: Stores the subscriber list and emits change stream
  - rationale: Streams trigger the welcome email from the committed write
  - configuration encryption: KMS
  - configuration backup: PITR
  - satisfies: R14, R5, I2
- **Welcome email queue** [mailq] - service: Amazon SQS
  - purpose: Buffers welcome email jobs
  - rationale: Decouples sending from subscription and allows retries
  - configuration encryption: KMS
  - satisfies: R5, I1
- **Email DLQ** [maildlq] - service: Amazon SQS
  - purpose: Holds email jobs that repeatedly fail
  - rationale: Failed messages are kept and alarmed on
  - configuration encryption: KMS
  - satisfies: I1, R5
- **Subscription stream relay** [streamfn] - service: AWS Lambda
  - purpose: Reads new subscriber records from the stream and enqueues email jobs
  - rationale: Reliable trigger from committed writes
  - satisfies: R5, R14, I1
- **Welcome email sender** [mailfn] - service: AWS Lambda
  - purpose: Sends the welcome email idempotently using partial batch responses
  - rationale: Serverless consumer for the queue
  - satisfies: R5, I1, R11
- **SES** [ses] - service: Amazon SES
  - purpose: Delivers welcome emails
  - rationale: Low-cost managed email sending
  - satisfies: R5, R9
- **Thumbnail queue** [thumbq] - service: Amazon SQS
  - purpose: Buffers upload events for thumbnail generation
  - rationale: Absorbs bursts and allows retries
  - configuration encryption: KMS
  - satisfies: R7, I1
- **Thumbnail DLQ** [thumbdlq] - service: Amazon SQS
  - purpose: Holds failed thumbnail jobs
  - rationale: Failed jobs are retained and alarmed on
  - configuration encryption: KMS
  - satisfies: I1, R7
- **Thumbnail generator** [thumbfn] - service: AWS Lambda
  - purpose: Creates thumbnails and writes them back to S3 idempotently
  - rationale: Event-driven serverless image processing
  - satisfies: R7, R12, R11, I1
- **KMS key** [kms] - service: AWS KMS
  - purpose: Customer managed key for data at rest
  - rationale: Encrypts buckets, tables and queues
  - satisfies: I2
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - purpose: Logs, metrics and alarms including DLQ depth
  - rationale: Observability and failure alerting
  - satisfies: I1, R11

**Edges**

- Readers -> CloudFront (invoke, HTTPS): Browse site, images and API reads
  - satisfies: R1, R8, R10, R2
- CloudFront -> Site and media bucket (origin, HTTPS): Static site and images origin
  - configuration originAccess: OAC
  - satisfies: R3, R4, R12
- CloudFront -> REST API (origin, HTTPS): Cached API origin
  - satisfies: R3, R4, R8
- WAF -> REST API (other, HTTPS): Protects API stage
  - satisfies: R15
- Authors -> Cognito user pool (invoke, HTTPS): Sign in
  - satisfies: R15
- Authors -> REST API (invoke, HTTPS): Manage posts, request upload URL
  - satisfies: R13, R6, R15
- REST API -> API handler (invoke, HTTPS): Invoke handler
  - satisfies: R3, R13, R14
- API handler -> Posts table (write, HTTPS): Read and write posts
  - satisfies: R13, R2
- API handler -> Subscribers table (write, HTTPS): Add subscriber
  - satisfies: R14
- Authors -> Site and media bucket (write, HTTPS): Upload photo with presigned URL
  - configuration presignedUrl: Short-lived presigned PUT to uploads/ prefix
  - satisfies: R6, R15
- Subscribers table -> Subscription stream relay (event, DynamoDB Streams): New subscriber record
  - satisfies: R5, R14
- Subscription stream relay -> Welcome email queue (write, HTTPS): Enqueue welcome email job
  - satisfies: R5
- Welcome email queue -> Welcome email sender (event, SQS event source): Consume with partial batch responses
  - configuration deadLetterQueue: Email DLQ via redrive policy
  - satisfies: R5, I1
- Welcome email queue -> Email DLQ (other, SQS redrive): Redrive after max receives
  - satisfies: I1
- Welcome email sender -> SES (invoke, HTTPS): Send welcome email
  - satisfies: R5
- Site and media bucket -> Thumbnail queue (event, S3 event notification): ObjectCreated on uploads/
  - configuration eventNotification: ObjectCreated filtered to uploads/ prefix
  - satisfies: R7, R6
- Thumbnail queue -> Thumbnail generator (event, SQS event source): Consume with partial batch responses
  - configuration deadLetterQueue: Thumbnail DLQ via redrive policy
  - satisfies: R7, I1
- Thumbnail queue -> Thumbnail DLQ (other, SQS redrive): Redrive after max receives
  - satisfies: I1
- Thumbnail generator -> Site and media bucket (write, HTTPS): Write thumbnails to thumbnails/ prefix
  - satisfies: R7, R12
- Email DLQ -> CloudWatch (other, CloudWatch metrics): Alarm on DLQ depth
  - satisfies: I1
- Thumbnail DLQ -> CloudWatch (other, CloudWatch metrics): Alarm on DLQ depth
  - satisfies: I1
- API handler -> CloudWatch (write, CloudWatch Logs): Logs and metrics
  - satisfies: I1, R11
- KMS key -> Site and media bucket (other, KMS): Encryption key for data at rest
  - satisfies: I2

### Design B

**Requirements**

- R1 [functional, confirmed] Serverless global blog
- R2 [non-functional, confirmed] Traffic is read-heavy with infrequent writes
- R3 [functional, confirmed] Serve a static site plus a REST API
- R4 [non-functional, confirmed] Use caching to reduce read load and latency
- R5 [functional, confirmed] Send a welcome email to new subscribers
- R6 [functional, confirmed] Authors can upload photos
- R7 [functional, confirmed] Generate thumbnails for uploaded photos
- R8 [non-functional, confirmed] Keep latency low for globally distributed readers
- R9 [constraint, confirmed] Keep operating cost low
- R10 [constraint, inferred] Use serverless components to avoid managing servers
- R11 [non-functional, inferred] Support reads from many regions with edge delivery of static content and API responses
- R12 [non-functional, inferred] Writes are rare, so write path can tolerate higher per-request latency than reads
- R13 [functional, inferred] Subscriber signup triggers an asynchronous welcome email rather than blocking the signup response
- R14 [functional, inferred] Thumbnail generation runs asynchronously after photo upload
- R15 [non-functional, inferred] Uploaded photos and blog content are stored durably
- C-auth-methods [functional, inferred] How should authors and subscribers sign in? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected number of readers and subscribers at peak? (decided by the architect)
- C-availability-target [functional, inferred] What availability target should the blog meet? (decided by the architect)
- I1 [constraint, inferred] Authors and subscribers must sign in securely; authors need authenticated write access to the API and uploads
- I2 [non-functional, inferred] Public read API must be protected against abuse and DDoS at the edge
- I3 [non-functional, inferred] Observability of API, Lambda and thumbnail pipeline with alarms on failed asynchronous processing
- I4 [non-functional, inferred] Blog content and photos must be backed up and recoverable
- I5 [constraint, inferred] Encryption at rest for stored photos, content and subscriber data

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-cloud]
  - Primary Region (Region) [c-region]

**Nodes**

- **Readers and Browsers** [n-reader] - EXTERNAL third-party: Readers and Browsers
  - purpose: Anonymous readers and subscribers accessing the blog worldwide
  - rationale: Source of read-heavy global traffic that drives edge caching
  - configuration presignedUrl: Clients upload photos directly to S3 via presigned URLs issued by the API
  - satisfies: R1, R2, R8, R11
- **Authors** [n-author] - EXTERNAL third-party: Authors
  - purpose: Authors who publish posts and upload photos
  - rationale: Source of infrequent writes and photo uploads
  - satisfies: R2, R6, R12
- **Amazon Route 53** [n-route53] - service: Amazon Route 53
  - purpose: DNS for the blog domain
  - rationale: Routes readers to CloudFront with global DNS resolution
  - satisfies: R1, R8, R11
- **Amazon CloudFront** [n-cloudfront] - service: Amazon CloudFront
  - purpose: Global CDN for static site and cached API responses
  - rationale: Edge delivery and caching lower latency and read load across regions
  - satisfies: R1, R3, R4, R8, R9, R11, C-user-scale, C-availability-target
- **AWS Shield** [n-shield] - service: AWS Shield
  - purpose: Standard DDoS protection for CloudFront and API Gateway
  - rationale: Protects the public entry point from volumetric attacks at no extra cost
  - satisfies: R1, I2
- **AWS WAF** [n-waf] - service: AWS WAF
  - purpose: Web firewall on the public REST API stage
  - rationale: Blocks common web exploits and abusive traffic at the API entry
  - satisfies: R3, I2
- **Static Site Bucket** [n-site-bucket] - service: Amazon S3
  - purpose: Stores static site files, private behind OAC
  - rationale: Serverless, low-cost static hosting; private bucket reached only through CloudFront
  - configuration backup: versioning
  - configuration encryption: AWS-managed
  - satisfies: R3, R9, R10, R15
- **Blog REST API** [n-api] - service: Amazon API Gateway
  - purpose: REST API for reading posts and authoring endpoints
  - rationale: REST type is required for AWS WAF; serverless front door for the API
  - configuration apiType: REST
  - configuration authorizer: Cognito user pool authorizer for author write routes
  - satisfies: R3, R10, R11, I1, C-availability-target
- **Amazon Cognito** [n-cognito] - service: Amazon Cognito
  - purpose: User pools for author and subscriber sign-in
  - rationale: Managed sign-in without running servers
  - satisfies: R1, R10, I1, C-auth-methods
- **Read API Function** [n-read-fn] - service: AWS Lambda
  - purpose: Serves post reads and processes writes from the API
  - rationale: Serverless compute; cost scales with requests in a read-heavy workload
  - satisfies: R2, R3, R10, R12, R9, C-user-scale
- **Content Table** [n-content-table] - service: Amazon DynamoDB
  - purpose: Stores blog posts and metadata
  - rationale: Serverless key-value store with low-latency reads and point-in-time recovery
  - configuration backup: PITR
  - configuration encryption: AWS-managed
  - satisfies: R2, R9, R10, R15, I4, I5
- **Subscriber Table** [n-subscriber-table] - service: Amazon DynamoDB
  - purpose: Stores subscriber records and signup state
  - rationale: Serverless store for subscriptions; transactional outbox via streams is not needed since signup uses SQS
  - configuration backup: PITR
  - configuration encryption: AWS-managed
  - satisfies: R5, R13, R15, I4, I5
- **Signup Function** [n-signup-fn] - service: AWS Lambda
  - purpose: Records a new subscriber and enqueues a welcome email job
  - rationale: Returns the signup response quickly and defers email to an async queue
  - satisfies: R5, R13, R10
- **Welcome Email Queue** [n-welcome-queue] - service: Amazon SQS
  - purpose: Buffers welcome email jobs
  - rationale: Decouples signup from email sending so the signup response is not blocked
  - configuration encryption: AWS-managed
  - satisfies: R5, R13, R9
- **Welcome Email DLQ** [n-welcome-dlq] - service: Amazon SQS
  - purpose: Holds welcome email jobs that repeatedly fail
  - rationale: Keeps failed sends for inspection and alarming without losing them
  - satisfies: R5, I3
- **Welcome Email Function** [n-email-fn] - service: AWS Lambda
  - purpose: Consumes welcome email jobs and sends email
  - rationale: Serverless consumer that scales with the queue
  - satisfies: R5, R13, R10
- **Amazon SES** [n-ses] - service: Amazon SES
  - purpose: Sends transactional welcome emails
  - rationale: Low-cost managed email delivery for subscribers
  - satisfies: R5, R9
- **Photo Bucket** [n-photo-bucket] - service: Amazon S3
  - purpose: Stores original uploaded photos and generated thumbnails
  - rationale: Durable object storage with versioning for uploads
  - configuration backup: versioning
  - configuration encryption: AWS-managed
  - configuration presignedUrl: Authors upload originals through presigned URLs
  - configuration eventNotification: ObjectCreated events trigger thumbnail generation
  - satisfies: R6, R7, R15, I4, I5
- **Thumbnail Function** [n-thumb-fn] - service: AWS Lambda
  - purpose: Creates thumbnails from uploaded photos
  - rationale: Serverless async processing after upload, scaling with upload volume
  - configuration deadLetterQueue: Failed events routed to thumbnail DLQ
  - satisfies: R7, R14, R10, R9
- **Thumbnail DLQ** [n-thumb-dlq] - service: Amazon SQS
  - purpose: Holds thumbnail events that failed processing
  - rationale: Preserves failed thumbnail jobs for retry and alarming
  - satisfies: R7, R14, I3
- **Amazon CloudWatch** [n-cloudwatch] - service: Amazon CloudWatch
  - purpose: Metrics, logs and alarms for API, functions and queues
  - rationale: Observability and DLQ depth alarms
  - satisfies: I3, R9
- **AWS KMS** [n-kms] - service: AWS KMS
  - purpose: Customer managed keys for sensitive data at rest
  - rationale: Provides key control for stored data where required
  - satisfies: I5

**Edges**

- Readers and Browsers -> Amazon Route 53 (invoke, HTTPS): Resolve blog domain
  - satisfies: R1, R8
- Readers and Browsers -> Amazon CloudFront (invoke, HTTPS): Read site and API
  - satisfies: R3, R4, R8, R11
- Amazon CloudFront -> Static Site Bucket (origin, HTTPS): Static site origin
  - configuration originAccess: OAC
  - satisfies: R3, R9
- Amazon CloudFront -> Blog REST API (origin, HTTPS): API origin with cached responses
  - satisfies: R3, R4, R11
- AWS WAF -> Blog REST API (other, HTTPS): Protects API stage
  - satisfies: I2
- Blog REST API -> Read API Function (invoke, HTTPS): Read requests
  - satisfies: R2, R12
- Read API Function -> Content Table (read, HTTPS): Read posts
  - satisfies: R2, R4
- Read API Function -> Content Table (write, HTTPS): Author writes posts
  - satisfies: R12
- Blog REST API -> Amazon Cognito (invoke, HTTPS): Validates author and subscriber tokens
  - satisfies: I1, C-auth-methods
- Blog REST API -> Signup Function (invoke, HTTPS): Subscribe request
  - satisfies: R5, R13
- Signup Function -> Subscriber Table (write, HTTPS): Store subscriber
  - satisfies: R5, R15
- Signup Function -> Welcome Email Queue (event, HTTPS): Enqueue welcome email job
  - satisfies: R13
- Welcome Email Queue -> Welcome Email Function (event, HTTPS): Welcome job trigger
  - configuration deadLetterQueue: Redrive to welcome DLQ after max receives
  - satisfies: R5, R13
- Welcome Email Function -> Amazon SES (invoke, HTTPS): Send welcome email
  - satisfies: R5
- Authors -> Photo Bucket (write, HTTPS): Upload photo via presigned URL
  - configuration presignedUrl: Short-lived URL issued by the API
  - satisfies: R6, R15
- Photo Bucket -> Thumbnail Function (event, HTTPS): ObjectCreated triggers thumbnail
  - configuration failureDestination: Failed events to thumbnail DLQ
  - satisfies: R7, R14
- Thumbnail Function -> Photo Bucket (write, HTTPS): Store thumbnail
  - satisfies: R7, R15

---

## Scenario: saas-containers-multi-az

**User prompt**

> We run a B2B SaaS REST API packaged as Docker containers. It needs a PostgreSQL database, a shared session cache, and must survive the loss of one availability zone. The containers must not be reachable from the internet directly, but they call a third-party payments API. Database credentials must be rotated automatically. We do not want to manage Kubernetes or servers.

**Enabled priorities** (chosen by the user with one-click toggles)

- Survive the loss of one Availability Zone: stateful services should run Multi-AZ.

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Run the B2B SaaS REST API packaged as Docker containers
- R2 [functional, confirmed] Provide a PostgreSQL database
- R3 [functional, confirmed] Provide a shared session cache
- R4 [non-functional, confirmed] Survive the loss of one availability zone
- R5 [constraint, confirmed] Containers must not be reachable from the internet directly
- R6 [functional, confirmed] Containers call a third-party payments API
- R7 [non-functional, confirmed] Database credentials must be rotated automatically
- R8 [constraint, confirmed] Do not manage Kubernetes or servers
- R9 [functional, inferred] Expose the API to clients through an internet-facing load balancer that forwards to private containers
- R10 [non-functional, inferred] Outbound calls to the payments API must egress through managed NAT or equivalent private egress
- C-user-scale [functional, inferred] What is the expected number of API tenants and peak requests per second? (decided by the architect)
- C-auth-methods [functional, inferred] How will API clients authenticate? (decided by the architect)
- C-region-residency [functional, inferred] Do you need data to stay in a specific country or region? (decided by the architect)
- T-dr [non-functional, confirmed] Survive the loss of one Availability Zone: stateful services run Multi-AZ.
- I1 [non-functional, inferred] Operational visibility of API, load balancer and database tiers through metrics, logs and alarms
- I2 [non-functional, inferred] Protect the internet-facing load balancer against common web attacks and abusive traffic
- I3 [constraint, inferred] Store third-party payments API credentials in a managed secret store, not in container images
- I4 [non-functional, inferred] Point-in-time recovery of the PostgreSQL database for accidental data loss

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-cloud]
  - Deployment Region (Region) [c-region]
    - Application VPC (VPC) [c-vpc]
      - Availability Zone A (Availability Zone) [c-az-a]
        - Public subnet A (Subnet, public) [c-sub-pub-a]
        - Private app subnet A (Subnet, private) [c-sub-app-a]
        - Private data subnet A (Subnet, private) [c-sub-data-a]
      - Availability Zone B (Availability Zone) [c-az-b]
        - Public subnet B (Subnet, public) [c-sub-pub-b]
        - Private app subnet B (Subnet, private) [c-sub-app-b]
        - Private data subnet B (Subnet, private) [c-sub-data-b]

**Nodes**

- **B2B API clients** [n-clients] - EXTERNAL third-party: B2B API clients
  - purpose: Tenant applications calling the SaaS REST API over HTTPS
  - rationale: Clients sit outside AWS and reach the API only through the public load balancer.
  - satisfies: R9, C-auth-methods
- **Payments API** [n-payments] - EXTERNAL third-party: Payments API
  - purpose: Third-party payment processing called by the API
  - rationale: External system reached over HTTPS through NAT egress.
  - satisfies: R6, R10
- **AWS WAF** [n-waf] - service: AWS WAF
  - in container: Deployment Region
  - purpose: Filters malicious and abusive requests before they reach the load balancer
  - rationale: Protects the public ALB entry point against common web exploits and floods.
  - satisfies: R5, I2
- **Application Load Balancer (AZ A)** [n-alb] - service: Application Load Balancer
  - in container: Public subnet A
  - purpose: Internet-facing HTTPS entry point that forwards to private API containers; authentication is enforced by the API on bearer JWTs
  - rationale: Public entry point with a node in Availability Zone A; paired with the AZ B node so the load balancer spans two Availability Zones and survives loss of one. Requests are authenticated by the API containers using bearer JWTs.
  - satisfies: R9, R4, R5, T-dr, C-auth-methods
- **Application Load Balancer (AZ B)** [n-alb-b] - service: Application Load Balancer
  - in container: Public subnet B
  - purpose: Second load balancer node in Availability Zone B for the same internet-facing entry point
  - rationale: Places the load balancer in a second Availability Zone so it keeps serving if Availability Zone A is lost.
  - satisfies: R9, R4, T-dr
- **API containers (Fargate)** [n-api] - service: AWS Fargate
  - in container: Private app subnet A
  - purpose: Runs the Dockerized B2B SaaS REST API without managing servers
  - rationale: Serverless containers meet the no-server requirement and run tasks across two Availability Zones with auto scaling for the stated scale.
  - satisfies: R1, R5, R6, R8, R4, T-dr, C-user-scale, C-auth-methods
- **Container image registry (Amazon ECR)** [n-ecr] - UNRESOLVED service (not in the catalog): Container image registry (Amazon ECR) - Fargate needs a registry for container images; ECR is not in the verified catalog.
  - purpose: Stores the Docker images that Fargate pulls
  - rationale: Fargate needs a registry for container images; ECR is not in the verified catalog.
  - satisfies: R1
- **NAT Gateway A** [n-nat-a] - service: NAT Gateway
  - in container: Public subnet A
  - purpose: Managed egress for private tasks in Availability Zone A
  - rationale: Provides managed outbound access to the payments API without public IPs on tasks.
  - satisfies: R10, R6, T-dr
- **NAT Gateway B** [n-nat-b] - service: NAT Gateway
  - in container: Public subnet B
  - purpose: Managed egress for private tasks in Availability Zone B
  - rationale: A second NAT Gateway keeps payments egress available if Availability Zone A is lost.
  - satisfies: R10, R6, T-dr
- **RDS Proxy** [n-proxy] - service: Amazon RDS Proxy
  - in container: Private data subnet A
  - purpose: Pools database connections between the API tasks and Aurora
  - rationale: Protects the database from connection spikes as tasks scale and handles failover transparently.
  - satisfies: R2, R4, C-user-scale
- **Aurora PostgreSQL** [n-aurora] - service: Amazon Aurora
  - in container: Private data subnet A
  - purpose: Managed PostgreSQL database with automatic failover across Availability Zones
  - rationale: Aurora PostgreSQL with readers in a second Availability Zone meets the database and zone-loss requirements with managed backups.
  - configuration backup: automated
  - configuration multiAz: writer and reader in 2 AZs
  - configuration encryption: AWS-managed
  - satisfies: R2, R4, T-dr, I4, C-region-residency
- **ElastiCache session cache** [n-cache] - service: Amazon ElastiCache
  - in container: Private data subnet B
  - purpose: Shared session store for all API containers
  - rationale: Managed Valkey/Redis OSS cache shared across tasks, with replicas in a second Availability Zone so sessions survive zone loss.
  - configuration backup: snapshots
  - configuration multiAz: replicas in 2 AZs
  - configuration encryption: AWS-managed
  - satisfies: R3, R4, T-dr
- **Secrets Manager** [n-secrets] - service: AWS Secrets Manager
  - in container: Deployment Region
  - purpose: Stores database and payments API credentials and rotates database credentials automatically
  - rationale: Automated rotation meets the credential rotation requirement without custom code or manual steps.
  - satisfies: R7, I3, C-region-residency
- **CloudWatch** [n-cloudwatch] - service: Amazon CloudWatch
  - in container: Deployment Region
  - purpose: Collects logs, metrics and alarms for the API, load balancer and databases
  - rationale: Provides the observability needed to operate the service and alarm on failures.
  - satisfies: I1, R4

**Edges**

- B2B API clients -> Application Load Balancer (AZ A) (invoke, HTTPS): API requests
  - satisfies: R9, C-auth-methods
- B2B API clients -> Application Load Balancer (AZ B) (invoke, HTTPS): API requests
  - satisfies: R9, R4, C-auth-methods
- AWS WAF -> Application Load Balancer (AZ A) (other): protects
  - satisfies: R5, I2
- AWS WAF -> Application Load Balancer (AZ B) (other): protects
  - satisfies: R5, I2
- Application Load Balancer (AZ A) -> API containers (Fargate) (invoke, HTTP): Forward to tasks
  - satisfies: R9, R5, R1
- Application Load Balancer (AZ B) -> API containers (Fargate) (invoke, HTTP): Forward to tasks
  - satisfies: R9, R5, R1, R4
- API containers (Fargate) -> RDS Proxy (invoke, PostgreSQL): Pooled DB connections
  - satisfies: R2, R4
- RDS Proxy -> Aurora PostgreSQL (read, PostgreSQL): Queries and writes
  - satisfies: R2, R4
- API containers (Fargate) -> ElastiCache session cache (read, Redis): Session reads and writes
  - satisfies: R3, R4
- API containers (Fargate) -> NAT Gateway A (invoke, HTTPS): Payments egress via AZ A
  - satisfies: R6, R10
- API containers (Fargate) -> NAT Gateway B (invoke, HTTPS): Payments egress via AZ B
  - satisfies: R6, R10, T-dr
- NAT Gateway A -> Payments API (invoke, HTTPS): Payment requests
  - satisfies: R6, R10
- NAT Gateway B -> Payments API (invoke, HTTPS): Payment requests
  - satisfies: R6, R10, T-dr
- API containers (Fargate) -> Secrets Manager (read, HTTPS): Read payments credentials
  - satisfies: I3, R7
- RDS Proxy -> Secrets Manager (read, HTTPS): Read database credentials
  - satisfies: R7
- Secrets Manager -> Aurora PostgreSQL (other): Automatic credential rotation
  - satisfies: R7
- Container image registry (Amazon ECR) -> API containers (Fargate) (other): Pull container images
  - satisfies: R1, R8
- API containers (Fargate) -> CloudWatch (write, HTTPS): Logs and metrics
  - satisfies: I1, R4

### Design B

**Requirements**

- R1 [functional, confirmed] Run the B2B SaaS REST API packaged as Docker containers
- R2 [functional, confirmed] Provide a PostgreSQL database
- R3 [functional, confirmed] Provide a shared session cache
- R4 [non-functional, confirmed] Survive the loss of one availability zone (Multi-AZ)
- R5 [constraint, confirmed] Containers must not be reachable from the internet directly
- R6 [functional, confirmed] Containers call a third-party payments API
- R7 [non-functional, confirmed] Database credentials must be rotated automatically
- R8 [constraint, confirmed] No Kubernetes and no server management; use managed services
- R9 [functional, inferred] Expose the API to clients through a managed entry point (load balancer or API gateway) in front of private containers
- R10 [non-functional, inferred] Control outbound egress so containers reach only the payments API and required AWS services
- R11 [non-functional, inferred] Store database and other secrets in a managed secrets store
- C-compliance [functional, inferred] Do you have compliance obligations that affect data handling, encryption, or logging? (decided by the architect)
- T-dr [non-functional, confirmed] Survive the loss of one Availability Zone: stateful services run Multi-AZ.
- I1 [constraint, inferred] Clients must authenticate to the API (API keys or JWT validated by the application) and tenant data must be isolated per customer
- I2 [non-functional, inferred] Data in transit must use TLS from clients to the load balancer and from containers to the database and payments API
- I3 [non-functional, inferred] Centralized logging and audit trail of API access and secret access to support compliance obligations

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-aws]
  - Region (Region) [c-region]
    - VPC (VPC) [c-vpc]
      - Availability Zone A (Availability Zone) [c-az-a]
        - Public subnet A (Subnet, public) [c-pub-a]
        - Private subnet A (Subnet, private) [c-priv-a]
      - Availability Zone B (Availability Zone) [c-az-b]
        - Public subnet B (Subnet, public) [c-pub-b]
        - Private subnet B (Subnet, private) [c-priv-b]

**Nodes**

- **B2B API clients** [n-clients] - EXTERNAL client-app: B2B API clients
  - purpose: Call the SaaS REST API over HTTPS
  - rationale: External consumers of the API; they never reach containers directly
  - satisfies: R9, I2
- **AWS WAF** [n-waf] - service: AWS WAF
  - in container: Region
  - purpose: Filter malicious web traffic before it reaches the load balancer
  - rationale: Adds a web firewall layer on the public entry point to reduce attack exposure
  - satisfies: R9, R5, I1
- **Application Load Balancer (AZ A)** [n-alb] - service: Application Load Balancer
  - in container: Public subnet A
  - purpose: Managed public entry point routing HTTPS requests to private API tasks in zone A
  - rationale: Provides the managed entry point in front of private containers; its zonal node in zone A is paired with the zone B node
  - satisfies: R9, R5, R4, T-dr, I2
- **Application Load Balancer (AZ B)** [n-alb-b] - service: Application Load Balancer
  - in container: Public subnet B
  - purpose: Managed public entry point routing HTTPS requests to private API tasks in zone B
  - rationale: Second zonal node of the load balancer so the entry point keeps serving if Availability Zone A is lost
  - satisfies: R9, R5, R4, T-dr, I2
- **NAT Gateway A** [n-nat-a] - service: NAT Gateway
  - in container: Public subnet A
  - purpose: Outbound internet access for private tasks in Availability Zone A
  - rationale: Allows egress only through a managed gateway, so tasks never have public IPs
  - satisfies: R10, R6, T-dr
- **NAT Gateway B** [n-nat-b] - service: NAT Gateway
  - in container: Public subnet B
  - purpose: Outbound internet access for private tasks in Availability Zone B
  - rationale: Keeps egress working if Availability Zone A is lost
  - satisfies: R10, R6, T-dr
- **API containers (AZ A)** [n-api-a] - service: AWS Fargate
  - in container: Private subnet A
  - purpose: Run the Dockerized B2B SaaS REST API tasks
  - rationale: Serverless containers avoid server and Kubernetes management and run without public IPs
  - satisfies: R1, R5, R8, R4, I1
- **API containers (AZ B)** [n-api-b] - service: AWS Fargate
  - in container: Private subnet B
  - purpose: Run the Dockerized B2B SaaS REST API tasks in a second zone
  - rationale: A second task set in another Availability Zone lets the API survive loss of one zone
  - satisfies: R1, R5, R8, R4, T-dr
- **Container registry (ECR)** [n-ecr] - UNRESOLVED service (not in the catalog): Amazon Elastic Container Registry - Stores and serves the Docker images that Fargate pulls; not in the verified catalog
  - in container: Region
  - purpose: Store the Docker images for the API
  - rationale: Fargate needs a registry for the container images
  - satisfies: R1, R8
- **RDS Proxy** [n-proxy] - service: Amazon RDS Proxy
  - in container: Private subnet A
  - purpose: Pool and reuse PostgreSQL connections from API tasks
  - rationale: Protects the database from connection storms during task scaling and failover
  - satisfies: R2, R4, T-dr
- **Aurora PostgreSQL** [n-aurora] - service: Amazon Aurora
  - in container: Private subnet A
  - purpose: Managed PostgreSQL database for the SaaS data
  - rationale: Managed PostgreSQL with automatic failover to a replica in another Availability Zone
  - configuration multiAz: Aurora replicas in another Availability Zone
  - configuration backup: Aurora automated backups
  - configuration encryption: KMS
  - satisfies: R2, R4, T-dr, R7, I1, I3
- **ElastiCache session cache** [n-elasticache] - service: Amazon ElastiCache
  - in container: Private subnet B
  - purpose: Shared session cache for all API tasks
  - rationale: Managed in-memory cache with Multi-AZ replicas so sessions survive loss of one zone
  - configuration multiAz: Replicas in another Availability Zone
  - configuration backup: ElastiCache snapshots
  - configuration encryption: AWS-managed
  - satisfies: R3, R4, T-dr
- **Secrets Manager** [n-secrets] - service: AWS Secrets Manager
  - in container: Region
  - purpose: Store database credentials and payments API keys and rotate DB credentials automatically
  - rationale: Managed secrets store with built-in rotation meets the rotation and secrets requirements
  - satisfies: R7, R11, I2
- **KMS key** [n-kms] - service: AWS KMS
  - in container: Region
  - purpose: Customer managed key for encrypting the database and secrets
  - rationale: Gives control over encryption keys for compliance
  - satisfies: I3, R11, C-compliance
- **Payments API** [n-payments] - EXTERNAL third-party: Third-party payments API
  - purpose: Process customer payments
  - rationale: Third-party service the containers must reach; the only non-AWS egress target
  - satisfies: R6, R10, I2
- **CloudWatch** [n-cw] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Collect logs, metrics and alarms for the API, database and cache
  - rationale: Observability and audit logging required for operations and compliance
  - satisfies: I3, R1, T-dr

**Edges**

- B2B API clients -> AWS WAF (invoke, HTTPS): API requests
  - satisfies: R9, I2
- AWS WAF -> Application Load Balancer (AZ A) (other): Protects load balancer
  - satisfies: R9, I1
- AWS WAF -> Application Load Balancer (AZ B) (other): Protects load balancer zone B
  - satisfies: R9, T-dr
- Application Load Balancer (AZ A) -> API containers (AZ A) (invoke, HTTP): Forward requests
  - satisfies: R9, R5, I2
- Application Load Balancer (AZ A) -> API containers (AZ B) (invoke, HTTP): Forward requests
  - satisfies: R9, R5, T-dr
- Application Load Balancer (AZ B) -> API containers (AZ A) (invoke, HTTP): Forward requests
  - satisfies: R9, R5, T-dr
- Application Load Balancer (AZ B) -> API containers (AZ B) (invoke, HTTP): Forward requests
  - satisfies: R9, R5, T-dr
- Container registry (ECR) -> API containers (AZ A) (other): Pull container image
  - satisfies: R1
- Container registry (ECR) -> API containers (AZ B) (other): Pull container image
  - satisfies: R1
- API containers (AZ A) -> RDS Proxy (invoke, PostgreSQL): Database connections
  - satisfies: R2, I2
- API containers (AZ B) -> RDS Proxy (invoke, PostgreSQL): Database connections
  - satisfies: R2, T-dr, I2
- RDS Proxy -> Aurora PostgreSQL (read, PostgreSQL): Pooled queries
  - satisfies: R2, R4, T-dr
- API containers (AZ A) -> ElastiCache session cache (read, Redis): Session read and write
  - satisfies: R3, I1
- API containers (AZ B) -> ElastiCache session cache (read, Redis): Session read and write
  - satisfies: R3, T-dr
- API containers (AZ A) -> Secrets Manager (read, HTTPS): Read database and payments credentials
  - satisfies: R11, R7
- Secrets Manager -> Aurora PostgreSQL (other): Automatic credential rotation
  - satisfies: R7, R11
- KMS key -> Aurora PostgreSQL (other): Encryption key for database
  - satisfies: I3, C-compliance
- API containers (AZ A) -> NAT Gateway A (other): Egress to payments API
  - satisfies: R10, R6
- API containers (AZ B) -> NAT Gateway B (other): Egress to payments API
  - satisfies: R10, R6, T-dr
- NAT Gateway A -> Payments API (invoke, HTTPS): Payment requests
  - satisfies: R6, R10, I2
- NAT Gateway B -> Payments API (invoke, HTTPS): Payment requests
  - satisfies: R6, R10, I2
- API containers (AZ A) -> CloudWatch (other): Logs and metrics
  - satisfies: I3, R1
- API containers (AZ B) -> CloudWatch (other): Logs and metrics
  - satisfies: I3, T-dr
