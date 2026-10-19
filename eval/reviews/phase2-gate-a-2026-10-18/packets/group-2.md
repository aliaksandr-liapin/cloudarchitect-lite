# Review packet, group 2

Scenarios in this packet: fraud-model-serving, brochure-site, saas-containers. Read `reviewer-instructions.md` for the task and the output format.

## Rubric

Score each design on seven dimensions, each 0-3 (0 = critical defect, 3 = production-grade for an MVP-level design).

| Dimension              | What is checked                                                              |
| ---------------------- | ---------------------------------------------------------------------------- |
| requirementCoverage    | All explicit requirements are reflected; assumptions are marked              |
| serviceFitness         | Service choices are justified; nothing redundant or expensive without reason |
| connectionCorrectness  | Direction, semantics, protocols and integrations are correct                 |
| securityBaseline       | Auth, least privilege, private data not public, encryption                   |
| reliabilityOperability | Error handling, DLQs, observability, fault tolerance                         |
| costAwareness          | No obvious overspend; serverless/managed where appropriate                   |
| explanationAccuracy    | Rationale and connection descriptions are technically correct                |

**Critical defect:** any dimension scored 0, or any incorrect technical statement that would lead the user to an insecure or non-working solution.

**Defect severities:** `minor` (cosmetic or small improvement), `major` (a real weakness or wrong detail that a careful architect would fix before building), `critical` (see above).

**Documentation rule:** every `major` or `critical` defect must cite an official AWS documentation or Well-Architected URL in its `evidence` field. A claim you cannot support with documentation should be recorded as `minor`.

---

## Scenario: fraud-model-serving

**User prompt**

> Our data science team trained a custom fraud-detection model in PyTorch. The checkout API must score every payment in real time and store the score with the transaction. We need a managed service to host and autoscale the custom model endpoint, and we retrain it monthly.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Score every payment in real time from the checkout API
- R2 [functional, confirmed] Store the fraud score with the transaction record
- R3 [functional, confirmed] Host the custom PyTorch fraud-detection model on a managed service
- R4 [non-functional, confirmed] Autoscale the model endpoint with checkout traffic
- R5 [functional, confirmed] Retrain the custom model monthly
- R6 [non-functional, inferred] Model scoring must respond fast enough to sit inline in the checkout request path
- R7 [functional, inferred] Retrained model versions must be deployed to the endpoint without manual rework of the serving stack
- R8 [non-functional, inferred] Model training data and artifacts must be stored durably and be reproducible for each monthly retrain
- C-availability-target [functional, inferred] What latency budget and availability level does the inline fraud check need, given it sits in the checkout path? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected peak payment volume per second, and how much will it grow? (decided by the architect)
- I1 [non-functional, inferred] Fraud scoring endpoint must be highly available across two Availability Zones and the checkout path must handle scoring failures with a timeout and fallback
- I2 [non-functional, inferred] Transaction data and scores must be encrypted at rest and access controlled
- I3 [non-functional, inferred] Alarm on scoring latency, errors and failed retraining runs

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Region (Region) [region]

**Nodes**

- **Checkout client** [client] - EXTERNAL client-app: Checkout client
  - purpose: Submits payments
  - rationale: Source of payment requests
  - satisfies: R1
- **Checkout API** [apigw] - service: Amazon API Gateway
  - in container: Region
  - purpose: Public checkout API entry
  - rationale: Managed API front end with IAM or Cognito authorization
  - configuration apiType: REST
  - configuration authorizer: Cognito
  - satisfies: R1, R6
- **User auth** [cognito] - service: Amazon Cognito
  - in container: Region
  - purpose: Authenticates checkout users
  - rationale: Protects the public API
  - satisfies: R1, I2
- **WAF** [waf] - service: AWS WAF
  - in container: Region
  - purpose: Protects the REST API
  - rationale: WAF works with REST API stages
  - satisfies: I2
- **Checkout function** [checkout] - service: AWS Lambda
  - in container: Region
  - purpose: Calls the model with a timeout, falls back on failure, stores score
  - rationale: Serverless checkout logic that sits inline
  - satisfies: R1, R2, R6, I1
- **SageMaker fraud endpoint** [sm_endpoint] - UNRESOLVED service (not in the catalog): Amazon SageMaker real-time endpoint - Managed hosting and autoscaling of custom PyTorch models; not in the catalog
  - in container: Region
  - purpose: Hosts the PyTorch model with autoscaling across two AZs
  - rationale: Managed low-latency real-time inference with target-tracking autoscaling
  - satisfies: R3, R4, R6, I1
- **Transactions table** [txn] - service: Amazon DynamoDB
  - in container: Region
  - purpose: Stores transactions with fraud scores
  - rationale: Low-latency key-value writes that scale with traffic
  - configuration backup: PITR
  - configuration encryption: AWS-managed
  - satisfies: R2, I2
- **Training data and artifacts** [s3] - service: Amazon S3
  - in container: Region
  - purpose: Versioned training datasets and model artifacts
  - rationale: Durable storage; versioning and dated prefixes make retrains reproducible
  - configuration backup: versioning
  - configuration encryption: AWS-managed
  - satisfies: R8, I2
- **Monthly schedule** [sched] - service: Amazon EventBridge
  - in container: Region
  - purpose: Triggers monthly retraining
  - rationale: Managed scheduling
  - satisfies: R5
- **Retrain workflow** [sfn] - service: AWS Step Functions
  - in container: Region
  - purpose: Runs training, registers model, updates the endpoint
  - rationale: Orchestrates retrain and deployment without manual steps
  - satisfies: R5, R7, R8
- **SageMaker training** [sm_train] - UNRESOLVED service (not in the catalog): Amazon SageMaker training job and model registry - Managed PyTorch training and versioned model registry; not in the catalog
  - in container: Region
  - purpose: Trains the PyTorch model monthly and registers the version
  - rationale: Managed training with versioned models
  - satisfies: R5, R7, R8
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Metrics, logs and alarms
  - rationale: Observability for latency, errors and training failures
  - satisfies: I3

**Edges**

- Checkout client -> Checkout API (invoke, HTTPS): Submit payment
  - satisfies: R1
- WAF -> Checkout API (other): Protects API
  - satisfies: I2
- Checkout API -> User auth (other): Authorize
  - satisfies: R1, I2
- Checkout API -> Checkout function (invoke): Invoke
  - satisfies: R1, R6
- Checkout function -> SageMaker fraud endpoint (invoke, HTTPS): Score payment
  - satisfies: R1, R3, R6
- Checkout function -> Transactions table (write): Store transaction and score
  - satisfies: R2
- Monthly schedule -> Retrain workflow (event): Monthly trigger
  - satisfies: R5
- Retrain workflow -> SageMaker training (invoke): Start training
  - satisfies: R5, R7
- SageMaker training -> Training data and artifacts (read): Read data, write artifacts
  - satisfies: R8
- Retrain workflow -> SageMaker fraud endpoint (invoke): Blue/green model update
  - satisfies: R7
- SageMaker fraud endpoint -> Training data and artifacts (read): Load model artifact
  - satisfies: R3, R7
- Checkout function -> CloudWatch (write): Logs and metrics
  - satisfies: I3
- SageMaker fraud endpoint -> CloudWatch (write): Endpoint metrics and alarms
  - satisfies: I3, R4
- Retrain workflow -> CloudWatch (write): Workflow failure alarms
  - satisfies: I3

### Design B

**Requirements**

- R1 [functional, confirmed] Checkout API must score every payment in real time
- R2 [functional, confirmed] Store the fraud score with the transaction record
- R3 [functional, confirmed] Host the custom PyTorch fraud-detection model on a managed service
- R4 [non-functional, confirmed] Autoscale the model endpoint with load
- R5 [functional, confirmed] Retrain the custom model monthly
- R6 [non-functional, inferred] Scoring must be fast enough to sit inline in the checkout request path
- R7 [functional, inferred] Retrained model versions must be deployable to the endpoint without manual rebuilding of the serving stack
- R8 [constraint, inferred] Model training data and artifacts must be stored durably for monthly retraining
- I1 [functional, inferred] Define a fallback payment decision when the scoring endpoint times out or is unavailable, so checkout never blocks indefinitely
- I2 [non-functional, inferred] Monitor scoring latency, error rate and endpoint capacity to detect inline latency regressions and autoscaling problems
- I3 [constraint, inferred] Encrypt payment transaction records, fraud scores and training data at rest

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c1]
  - Region (Region) [c2]

**Nodes**

- **Checkout API (HTTP API)** [n1] - service: Amazon API Gateway
  - purpose: Receives checkout payment requests and routes them to the scoring handler
  - rationale: HTTP API is the simplest low-latency entry point for the checkout service; WAF is not required by any stated requirement
  - configuration apiType: HTTP
  - configuration authorizer: IAM
  - satisfies: R1, R6
- **Checkout scoring handler** [n2] - service: AWS Lambda
  - in container: Region
  - purpose: Calls the fraud model endpoint inline, applies the fallback decision on failure, and stores the score with the transaction
  - rationale: Lambda is serverless and scales with checkout traffic; the handler keeps the scoring call short and applies the fallback on timeout
  - satisfies: R1, R2, R6, I1, I2
- **Fraud model real-time endpoint (SageMaker AI)** [n3] - UNRESOLVED service (not in the catalog): Fraud model real-time endpoint (SageMaker AI) - A managed real-time inference endpoint with autoscaling hosts the custom PyTorch model and meets inline latency needs
  - in container: Region
  - purpose: Hosts the custom PyTorch fraud model and returns a score in real time
  - rationale: A managed real-time inference endpoint with autoscaling hosts the custom PyTorch model and meets inline latency needs
  - satisfies: R3, R4, R6, R7
- **Transactions table with fraud score** [n4] - service: Amazon DynamoDB
  - in container: Region
  - purpose: Stores each transaction record together with its fraud score
  - rationale: DynamoDB gives single-digit millisecond writes for the checkout path; PITR protects transaction history and encryption protects stored payment data
  - configuration backup: PITR
  - configuration encryption: AWS-managed
  - satisfies: R2, I3
- **Training data and model artifact bucket** [n5] - service: Amazon S3
  - in container: Region
  - purpose: Durably stores training datasets and versioned PyTorch model artifacts
  - rationale: S3 provides durable storage for monthly retraining data and model versions; versioning allows recovery of earlier artifacts
  - configuration backup: versioning
  - configuration encryption: AWS-managed
  - satisfies: R7, R8, I3
- **Monthly retraining schedule** [n6] - service: Amazon EventBridge
  - in container: Region
  - purpose: Triggers the retraining pipeline once a month
  - rationale: EventBridge scheduled rules provide a managed, serverless monthly trigger
  - satisfies: R5
- **Model training and registry pipeline (SageMaker AI)** [n7] - UNRESOLVED service (not in the catalog): Model training and registry pipeline (SageMaker AI) - A managed training pipeline with a model registry lets retrained versions be deployed without rebuilding the serving stack
  - in container: Region
  - purpose: Trains the PyTorch model on new data, registers the new version and deploys it to the endpoint
  - rationale: A managed training pipeline with a model registry lets retrained versions be deployed without rebuilding the serving stack
  - satisfies: R5, R7, R8
- **Monitoring and alarms** [n8] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Collects scoring latency, error and endpoint capacity metrics and alarms on breaches
  - rationale: CloudWatch provides the metrics and alarms needed to watch inline scoring latency and autoscaling behaviour
  - satisfies: R6, I2

**Edges**

- Checkout API (HTTP API) -> Checkout scoring handler (invoke, HTTPS): Payment scoring request
  - satisfies: R1, R6
- Checkout scoring handler -> Fraud model real-time endpoint (SageMaker AI) (invoke, HTTPS): Score payment (synchronous, with timeout)
  - satisfies: R1, R6, I1
- Checkout scoring handler -> Transactions table with fraud score (write, HTTPS): Store transaction with fraud score
  - satisfies: R2
- Fraud model real-time endpoint (SageMaker AI) -> Training data and model artifact bucket (read): Load model artifact at deployment
  - satisfies: R3, R7
- Monthly retraining schedule -> Model training and registry pipeline (SageMaker AI) (event): Monthly retraining trigger
  - satisfies: R5
- Model training and registry pipeline (SageMaker AI) -> Training data and model artifact bucket (read): Read training data
  - satisfies: R5, R8
- Model training and registry pipeline (SageMaker AI) -> Training data and model artifact bucket (write): Write new model version
  - satisfies: R7, R8
- Model training and registry pipeline (SageMaker AI) -> Fraud model real-time endpoint (SageMaker AI) (other): Deploy new model version to endpoint
  - satisfies: R4, R7

---

## Scenario: brochure-site

**User prompt**

> A local bakery wants a simple marketing website: five static pages, a menu and opening hours, served under their own domain with HTTPS. Traffic is a few hundred visits a day. The budget is a few dollars a month and nobody will maintain servers.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Simple marketing website with five static pages
- R2 [functional, confirmed] Menu page
- R3 [functional, confirmed] Opening hours page
- R4 [functional, confirmed] Served under the bakery's own custom domain
- R5 [non-functional, confirmed] HTTPS for all traffic
- R6 [non-functional, confirmed] Handle traffic of a few hundred visits per day
- R7 [constraint, confirmed] Operating cost of a few dollars per month
- R8 [constraint, confirmed] No server maintenance; fully managed hosting
- R9 [non-functional, inferred] Content is static and served without server-side processing
- I1 [constraint, inferred] The S3 bucket must not be publicly readable; only CloudFront may read objects, so visitors cannot bypass HTTPS or the CDN.
- I2 [functional, inferred] Visitors requesting a directory such as /menu or /hours must receive its index page, so the five pages have clean URLs.
- I3 [non-functional, inferred] The bakery needs basic visibility of traffic and errors so that a broken site or a sudden traffic spike is noticed.

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-cloud]
  - us-east-1 (Region) [c-region]

**Nodes**

- **Website visitors** [n-visitor] - EXTERNAL third-party: Website visitors
  - purpose: Browse the bakery's five pages, menu and opening hours from a web browser.
  - rationale: Represents the public audience that reaches the site over HTTPS through the custom domain.
  - satisfies: R1, R2, R3, R4, R5
- **Bakery staff or developer** [n-staff] - EXTERNAL third-party: Bakery staff or developer
  - purpose: Uploads updated pages, menu and opening hours to the bucket.
  - rationale: Content changes are made by the bakery or a developer, not by visitors, so they write objects directly to S3 with IAM credentials.
  - satisfies: R1, R2, R3, R8
- **Amazon Route 53** [n-dns] - service: Amazon Route 53
  - purpose: Hosts DNS records that map the bakery's custom domain to CloudFront.
  - rationale: Route 53 provides a managed hosted zone with an alias record to CloudFront, so the bakery uses its own domain with no DNS servers to run.
  - satisfies: R4, R8
- **Amazon CloudFront** [n-cdn] - service: Amazon CloudFront
  - purpose: Serves the website over HTTPS from edge locations and caches static pages close to visitors.
  - rationale: CloudFront terminates TLS with the ACM certificate, redirects HTTP to HTTPS, caches static files to keep origin requests minimal, and is pay-per-use with a free tier that suits a few hundred visits per day.
  - satisfies: R4, R5, R6, R7, R8, R9, I2
- **AWS Certificate Manager** [n-cert] - service: AWS Certificate Manager
  - purpose: Issues and automatically renews the public TLS certificate for the custom domain.
  - rationale: ACM provides free public certificates that renew automatically, meeting the HTTPS requirement without manual certificate management. CloudFront requires the certificate to be in us-east-1.
  - satisfies: R4, R5, R8
- **Amazon S3 website bucket** [n-bucket] - service: Amazon S3
  - purpose: Stores the static HTML, CSS, JavaScript and images for the five pages, menu and opening hours.
  - rationale: S3 stores static files durably and cheaply with no servers. The bucket is private and read only through CloudFront with OAC, and versioning protects against accidental overwrites.
  - configuration backup: versioning
  - configuration encryption: AWS-managed
  - satisfies: R1, R2, R3, R7, R8, R9, I1
- **AWS IAM** [n-iam] - service: AWS IAM
  - purpose: Grants write access to the bucket only to the bakery's named staff or developer identities.
  - rationale: IAM policies authorize each upload request, so the write path is controlled and no anonymous or public write access exists, while the bucket stays private to visitors.
  - satisfies: R8, I1
- **Amazon CloudWatch** [n-monitor] - service: Amazon CloudWatch
  - purpose: Collects CloudFront request and error metrics and raises an alarm when error rates rise.
  - rationale: CloudWatch provides built-in CloudFront metrics at no extra cost, giving visibility into traffic and failures without running any monitoring servers.
  - satisfies: R6, R8, I3

**Edges**

- Website visitors -> Amazon Route 53 (invoke, DNS): Resolves custom domain
  - satisfies: R4
- Website visitors -> Amazon CloudFront (invoke, HTTPS): Requests pages over HTTPS
  - satisfies: R1, R2, R3, R5, R6
- Amazon CloudFront -> Amazon S3 website bucket (origin, HTTPS): Fetches static files from private bucket
  - configuration originAccess: OAC
  - satisfies: R1, R9, I1, I2
- Bakery staff or developer -> Amazon S3 website bucket (write, HTTPS): Uploads updated pages with IAM credentials
  - satisfies: R1, R2, R3, R8
- AWS IAM -> Amazon S3 website bucket (other): Grants staff write access via IAM policy
  - satisfies: R8, I1
- AWS Certificate Manager -> Amazon CloudFront (other): Provides TLS certificate
  - satisfies: R4, R5
- Amazon CloudFront -> Amazon CloudWatch (other): Publishes request and error metrics
  - satisfies: R6, I3

### Design B

**Requirements**

- R1 [functional, confirmed] Simple marketing website with five static pages
- R2 [functional, confirmed] Menu page and opening hours shown on the site
- R3 [constraint, confirmed] Served under the bakery's own custom domain
- R4 [non-functional, confirmed] HTTPS for all site traffic
- R5 [non-functional, confirmed] Handle traffic of a few hundred visits per day
- R6 [constraint, confirmed] Operating budget of a few dollars per month
- R7 [constraint, confirmed] No server maintenance; fully managed hosting
- R8 [functional, inferred] Content is static, so no server-side application logic is required
- R9 [non-functional, inferred] Site remains available to visitors at all times with minimal operational effort
- I1 [constraint, inferred] Site content bucket must stay private and be readable only through CloudFront
- I2 [non-functional, inferred] Basic monitoring of site availability and error rates

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Primary Region (Region) [region]

**Nodes**

- **Visitor browser** [visitor] - EXTERNAL user: Website visitor
  - purpose: Views the bakery pages, menu and opening hours
  - rationale: Represents the public audience
  - satisfies: R1, R2, R5
- **Route 53 DNS** [dns] - service: Amazon Route 53
  - in container: AWS Cloud
  - purpose: Maps the bakery's custom domain to the CloudFront distribution
  - rationale: Provides the custom domain with an alias record at low cost
  - satisfies: R3, R7, R9
- **CloudFront distribution** [cdn] - service: Amazon CloudFront
  - in container: AWS Cloud
  - purpose: Serves the site over HTTPS on the custom domain and caches content at the edge
  - rationale: Fully managed, low cost at this traffic, and the only practical way to serve a custom domain over HTTPS from S3
  - satisfies: R1, R3, R4, R5, R6, R7, R9
- **ACM certificate** [cert] - service: AWS Certificate Manager
  - in container: Primary Region
  - purpose: Free TLS certificate for the custom domain attached to CloudFront
  - rationale: Public ACM certificates are free and renew automatically
  - satisfies: R3, R4, R7
- **Site content bucket** [site] - service: Amazon S3
  - in container: Primary Region
  - purpose: Stores the five static pages, menu and opening hours
  - rationale: Cheapest managed hosting for static files with no servers; kept private behind CloudFront
  - configuration backup: versioning
  - configuration encryption: AWS-managed
  - satisfies: R1, R2, R6, R7, R8, R9, I1
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - in container: Primary Region
  - purpose: Metrics and alarms on CloudFront errors
  - rationale: Gives minimal-effort visibility into availability
  - satisfies: I2, R9

**Edges**

- Visitor browser -> Route 53 DNS (invoke, DNS): Resolve bakery domain
  - satisfies: R3
- Visitor browser -> CloudFront distribution (invoke, HTTPS): Request pages over HTTPS
  - satisfies: R1, R2, R4, R5
- CloudFront distribution -> Site content bucket (origin, HTTPS): Fetch static files via OAC
  - configuration originAccess: OAC
  - satisfies: R1, R2, R8, I1
- ACM certificate -> CloudFront distribution (other, TLS): Provides TLS certificate
  - satisfies: R3, R4
- Route 53 DNS -> CloudFront distribution (other, DNS): Alias record to distribution
  - satisfies: R3
- CloudFront distribution -> CloudWatch (other, metrics): Publishes distribution metrics
  - satisfies: I2, R9

---

## Scenario: saas-containers

**User prompt**

> We run a B2B SaaS REST API packaged as Docker containers. It needs a PostgreSQL database, a shared session cache, and must survive the loss of one availability zone. The containers must not be reachable from the internet directly, but they call a third-party payments API. Database credentials must be rotated automatically. We do not want to manage Kubernetes or servers.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] B2B SaaS REST API packaged as Docker containers
- R2 [functional, confirmed] PostgreSQL database
- R3 [functional, confirmed] Shared session cache
- R4 [functional, confirmed] Calls a third-party payments API
- R5 [non-functional, confirmed] Must survive the loss of one availability zone
- R6 [constraint, confirmed] Containers must not be directly reachable from the internet
- R7 [constraint, confirmed] Database credentials must be rotated automatically
- R8 [constraint, confirmed] No Kubernetes and no self-managed servers
- R9 [constraint, inferred] Containers run in private subnets with controlled outbound access to the payments API
- R10 [non-functional, inferred] Database and session cache run as managed services with Multi-AZ failover
- R11 [constraint, inferred] Secrets stored and rotated through a managed secrets service
- C-auth-methods [functional, inferred] How do API clients authenticate to the service? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected number of tenants and peak requests per second? (decided by the architect)
- C-compliance [functional, inferred] Which compliance regimes must the workload meet? (decided by the architect)
- I1 [functional, inferred] API clients authenticate with OAuth2 access tokens validated at the edge of the API
- I2 [non-functional, inferred] Container logs, metrics and alarms are collected for operations
- I3 [constraint, inferred] Data at rest is encrypted with customer managed keys, and the public entry point is protected by a web firewall
- I4 [non-functional, inferred] Container images are pulled and the database is reached without exposing tasks publicly

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Region (Region) [region]
    - Application VPC (VPC) [vpc]
      - Availability Zone A (Availability Zone) [az1]
        - Public subnet A (Subnet, public) [pub1]
        - Private app subnet A (Subnet, private) [app1]
        - Private data subnet A (Subnet, private) [data1]
      - Availability Zone B (Availability Zone) [az2]
        - Public subnet B (Subnet, public) [pub2]
        - Private app subnet B (Subnet, private) [app2]
        - Private data subnet B (Subnet, private) [data2]

**Nodes**

- **API clients** [clients] - EXTERNAL client-app: API clients (tenant systems)
  - purpose: Call the REST API
  - rationale: B2B consumers of the service
  - satisfies: R1
- **Third-party payments API** [payments] - EXTERNAL third-party: Payments API
  - purpose: Processes payments
  - rationale: External provider called by the service
  - satisfies: R4
- **WAF** [waf] - service: AWS WAF
  - purpose: Filter malicious requests at the ALB
  - rationale: Protects the only public entry point
  - satisfies: R1, I3
- **Cognito user pool** [cognito] - service: Amazon Cognito
  - purpose: Issues OAuth2 tokens to API clients
  - rationale: Managed client authentication; the API validates the JWTs
  - satisfies: I1
- **ACM certificate** [acm] - service: AWS Certificate Manager
  - purpose: TLS certificate for the ALB listener
  - rationale: Encrypts traffic in transit
  - satisfies: R1, I3
- **Application Load Balancer** [alb1] - service: Application Load Balancer
  - purpose: Internet-facing entry point forwarding to private tasks
  - rationale: Only the ALB is public; spans two AZ subnets so it survives an AZ loss
  - satisfies: R1, R5, R6
- **NAT Gateway A** [nat1] - service: NAT Gateway
  - purpose: Outbound access for AZ A tasks
  - rationale: Controlled egress to the payments API; one per AZ keeps egress available if an AZ fails
  - satisfies: R4, R9, R5
- **NAT Gateway B** [nat2] - service: NAT Gateway
  - purpose: Outbound access for AZ B tasks
  - rationale: Controlled egress in the second AZ
  - satisfies: R4, R9, R5
- **API tasks AZ A** [task1] - service: AWS Fargate
  - purpose: Run the API containers
  - rationale: Serverless containers, no servers or Kubernetes to manage
  - satisfies: R1, R5, R6, R8, R9
- **API tasks AZ B** [task2] - service: AWS Fargate
  - purpose: Run the API containers
  - rationale: Second AZ for resilience
  - satisfies: R1, R5, R6, R8, R9
- **ECS service** [ecs] - service: Amazon ECS
  - purpose: Orchestrate and scale the containers across both AZs
  - rationale: Managed orchestration without Kubernetes
  - satisfies: R1, R5, R8
- **Aurora PostgreSQL** [aurora] - service: Amazon Aurora
  - purpose: Relational database with a writer and a reader in another AZ
  - rationale: Managed PostgreSQL with automatic failover
  - configuration multiAz: Aurora replicas across AZs
  - configuration backup: Automated backups
  - configuration encryption: KMS
  - satisfies: R2, R5, R10, I3
- **ElastiCache session cache** [cache] - service: Amazon ElastiCache
  - purpose: Shared session store
  - rationale: Managed Valkey/Redis OSS with Multi-AZ failover
  - configuration multiAz: Replica in second AZ
  - configuration backup: Snapshots
  - configuration encryption: KMS
  - satisfies: R3, R5, R10, I3
- **Secrets Manager** [secrets] - service: AWS Secrets Manager
  - purpose: Stores and rotates DB credentials and holds the payments API key
  - rationale: Managed automatic rotation
  - satisfies: R7, R11, R4
- **KMS key** [kms] - service: AWS KMS
  - purpose: Customer managed key for data stores
  - rationale: Encryption at rest
  - satisfies: I3
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - purpose: Logs, metrics and alarms
  - rationale: Observability
  - satisfies: I2

**Edges**

- API clients -> Application Load Balancer (invoke, HTTPS): API requests with bearer token
  - satisfies: R1, I1
- WAF -> Application Load Balancer (other): Protects ALB
  - satisfies: I3
- Application Load Balancer -> API tasks AZ A (invoke, HTTP): Forward to tasks
  - satisfies: R1, R6, R5
- Application Load Balancer -> API tasks AZ B (invoke, HTTP): Forward to tasks
  - satisfies: R1, R6, R5
- ECS service -> API tasks AZ A (other): Schedules tasks
  - satisfies: R8
- ECS service -> API tasks AZ B (other): Schedules tasks
  - satisfies: R8
- API tasks AZ A -> Aurora PostgreSQL (write, PostgreSQL): SQL
  - satisfies: R2
- API tasks AZ B -> Aurora PostgreSQL (write, PostgreSQL): SQL
  - satisfies: R2
- API tasks AZ A -> ElastiCache session cache (write, Redis): Sessions
  - satisfies: R3
- API tasks AZ B -> ElastiCache session cache (write, Redis): Sessions
  - satisfies: R3
- API tasks AZ A -> NAT Gateway A (invoke): Outbound
  - satisfies: R4, R9
- API tasks AZ B -> NAT Gateway B (invoke): Outbound
  - satisfies: R4, R9
- NAT Gateway A -> Third-party payments API (invoke, HTTPS): Payment calls
  - satisfies: R4
- NAT Gateway B -> Third-party payments API (invoke, HTTPS): Payment calls
  - satisfies: R4
- API tasks AZ A -> Secrets Manager (read, HTTPS): Read DB and payments secrets
  - satisfies: R7, R11
- API tasks AZ B -> Secrets Manager (read, HTTPS): Read DB and payments secrets
  - satisfies: R7, R11
- Secrets Manager -> Aurora PostgreSQL (write): Rotate DB password
  - satisfies: R7, R11
- API tasks AZ A -> Cognito user pool (read, HTTPS): Fetch JWKS to validate tokens
  - satisfies: I1
- API tasks AZ A -> CloudWatch (write): Logs and metrics
  - satisfies: I2
- API tasks AZ B -> CloudWatch (write): Logs and metrics
  - satisfies: I2
- KMS key -> Aurora PostgreSQL (other): Encrypts data
  - satisfies: I3
- ACM certificate -> Application Load Balancer (other): TLS certificate
  - satisfies: I3, R1
- KMS key -> ElastiCache session cache (other): Encrypts data
  - satisfies: I3

### Design B

**Requirements**

- R1 [functional, confirmed] Run the B2B SaaS REST API as Docker containers
- R2 [functional, confirmed] Provide a PostgreSQL database for the API
- R3 [functional, confirmed] Provide a shared session cache accessible by the API containers
- R4 [constraint, confirmed] Containers must not be directly reachable from the internet
- R5 [functional, confirmed] Containers must be able to call a third-party payments API
- R6 [non-functional, confirmed] Database credentials must be rotated automatically
- R7 [non-functional, confirmed] Application must survive the loss of one availability zone
- R8 [constraint, confirmed] Do not manage Kubernetes or servers (use fully managed, serverless-style container and data services)
- R9 [non-functional, inferred] Public entry point for API clients should route through a managed edge that reaches containers only through private networking
- R10 [non-functional, inferred] Outbound calls to the payments API should egress through controlled, managed NAT or egress infrastructure with a stable source address if the provider requires allowlisting
- R11 [non-functional, inferred] Database and cache must be deployed across multiple availability zones with automatic failover
- R12 [non-functional, inferred] Secrets such as payments API keys and database credentials must be stored in a managed secrets service and not in images or code
- R13 [non-functional, inferred] Container images must be stored in a managed private registry
- R14 [non-functional, inferred] Logging and monitoring of API containers, database, and cache should be centralized
- R15 [non-functional, inferred] Scaling of API containers should be managed automatically to match load
- C-availability-target [functional, inferred] What uptime target should the API meet, and is a multi-AZ setup sufficient or do you need cross-region recovery? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected request volume and number of tenants at launch and in 12 months? (decided by the architect)
- C-data-retention [functional, inferred] How long must tenant data and session data be retained, and must backups be kept? (decided by the architect)
- I1 [constraint, inferred] Encryption at rest for the PostgreSQL database, the session cache and the secrets in use
- I2 [non-functional, inferred] Database and cache backups with point-in-time recovery so tenant data can be restored after corruption or deletion
- I3 [non-functional, inferred] Centralized audit trail of API and management actions
- I4 [functional, inferred] Authentication of API clients before requests reach the containers

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-root]
  - Region (Region) [c-region]
    - VPC (VPC) [c-vpc]
      - Availability Zone A (Availability Zone) [c-az1]
        - Public subnet A (Subnet, public) [c-pub1]
        - App private subnet A (Subnet, private) [c-app1]
        - Data private subnet A (Subnet, private) [c-data1]
      - Availability Zone B (Availability Zone) [c-az2]
        - Public subnet B (Subnet, public) [c-pub2]
        - App private subnet B (Subnet, private) [c-app2]
        - Data private subnet B (Subnet, private) [c-data2]

**Nodes**

- **B2B API clients** [n-client] - EXTERNAL third-party: B2B API clients
  - purpose: Tenant applications calling the REST API
  - rationale: External callers of the public API
  - satisfies: R9, I4
- **Third-party payments API** [n-payments] - EXTERNAL third-party: Third-party payments API
  - purpose: Payment processing called by the API
  - rationale: Third-party service reached over HTTPS
  - satisfies: R5, R10
- **CloudFront distribution** [n-cloudfront] - service: Amazon CloudFront
  - purpose: Managed public edge for API clients with TLS termination
  - rationale: Single managed public entry point; forwards to the ALB origin only
  - satisfies: R9, R4
- **AWS WAF** [n-waf] - service: AWS WAF
  - purpose: Filters malicious traffic at the edge
  - rationale: Protects the public entry point from common web attacks
  - satisfies: R9, I4
- **Amazon Cognito user pool** [n-cognito] - service: Amazon Cognito
  - in container: Region
  - purpose: Issues JWTs that authenticate tenant API clients
  - rationale: Managed user authentication so the containers validate tokens before serving requests
  - satisfies: I4
- **Application Load Balancer** [n-alb] - service: Application Load Balancer
  - in container: Public subnet A
  - purpose: Routes API requests to healthy Fargate tasks across two zones
  - rationale: Spans two Availability Zones and load balances to private containers
  - satisfies: R9, R7, R1, C-availability-target
- **Fargate API tasks** [n-fargate] - service: AWS Fargate
  - in container: App private subnet A
  - purpose: Runs the Docker containers of the B2B SaaS REST API
  - rationale: Serverless containers with no servers or Kubernetes to manage
  - satisfies: R1, R4, R7, R8, R15, C-user-scale
- **Amazon ECS service** [n-ecr] - service: Amazon ECS
  - in container: Region
  - purpose: Runs and scales the Fargate API task definition
  - rationale: Managed container orchestration for Fargate with automatic scaling
  - satisfies: R1, R8, R15, C-user-scale
- **NAT Gateway** [n-nat] - service: NAT Gateway
  - in container: Public subnet A
  - purpose: Managed egress to the payments API with stable Elastic IP addresses
  - rationale: Gives outbound calls a controlled source address for allowlisting
  - satisfies: R5, R10
- **Aurora PostgreSQL cluster** [n-aurora] - service: Amazon Aurora
  - in container: Data private subnet A
  - purpose: PostgreSQL database for tenant data with Multi-AZ failover
  - rationale: Managed PostgreSQL-compatible database with automatic cross-AZ failover
  - configuration multiAz: True
  - configuration backup: PITR
  - configuration encryption: KMS
  - satisfies: R2, R7, R11, I2, C-availability-target, C-data-retention
- **RDS Proxy** [n-rdsproxy] - service: Amazon RDS Proxy
  - in container: Data private subnet A
  - purpose: Pools database connections from Fargate tasks
  - rationale: Protects the database from connection spikes during autoscaling
  - satisfies: R2, R15, C-user-scale
- **Secrets Manager** [n-secrets] - service: AWS Secrets Manager
  - purpose: Stores database credentials with automatic rotation and payments API keys
  - rationale: Managed secret storage with rotation keeps secrets out of images and code
  - satisfies: R6, R12
- **ElastiCache session cache** [n-redis] - service: Amazon ElastiCache
  - in container: Data private subnet B
  - purpose: Shared session cache across API tasks
  - rationale: Multi-AZ replicas with automatic failover for session data
  - configuration multiAz: True
  - configuration encryption: KMS
  - configuration backup: snapshots
  - satisfies: R3, R11, R7, I2, C-data-retention
- **Amazon ECR image registry** [n-ecrrepo] - UNRESOLVED service (not in the catalog): Amazon ECR image registry - Managed private registry for the API images
  - purpose: Stores Docker images for the API
  - rationale: Managed private registry for the API images
  - satisfies: R13
- **CloudWatch** [n-cw] - service: Amazon CloudWatch
  - purpose: Central logs, metrics and alarms for containers, database and cache
  - rationale: Single place for operational telemetry
  - satisfies: R14, I3
- **KMS** [n-kms] - service: AWS KMS
  - purpose: Customer managed keys for encryption at rest
  - rationale: Encrypts database, cache and secrets with a managed key
  - satisfies: I1, R12

**Edges**

- B2B API clients -> CloudFront distribution (invoke, HTTPS): API calls
  - satisfies: R9
- AWS WAF -> CloudFront distribution (other): WAF protects distribution
  - satisfies: R9
- CloudFront distribution -> Application Load Balancer (origin, HTTPS): Forward API requests
  - satisfies: R9, R4
- Application Load Balancer -> Fargate API tasks (invoke, HTTP): Route to tasks
  - satisfies: R1, R4, R7
- Fargate API tasks -> RDS Proxy (invoke, PostgreSQL): Database connections
  - satisfies: R2, R7
- RDS Proxy -> Aurora PostgreSQL cluster (read, PostgreSQL): Pooled queries
  - satisfies: R2, R11
- Fargate API tasks -> ElastiCache session cache (read, TLS): Session reads and writes
  - satisfies: R3
- Fargate API tasks -> NAT Gateway (invoke, HTTPS): Outbound to payments
  - satisfies: R5, R10
- NAT Gateway -> Third-party payments API (invoke, HTTPS): Payments API calls
  - satisfies: R5, R10
- Secrets Manager -> RDS Proxy (read, API): Database credentials
  - satisfies: R6, R12
- Amazon ECR image registry -> Fargate API tasks (other): Image pull
  - satisfies: R13, R1
- Fargate API tasks -> CloudWatch (other): Logs and metrics
  - satisfies: R14
- Aurora PostgreSQL cluster -> CloudWatch (other): Database metrics
  - satisfies: R14
- ElastiCache session cache -> CloudWatch (other): Cache metrics
  - satisfies: R14
- KMS -> Aurora PostgreSQL cluster (other): Encryption key
  - satisfies: I1
- B2B API clients -> Amazon Cognito user pool (invoke, HTTPS): Obtain access tokens
  - satisfies: I4
