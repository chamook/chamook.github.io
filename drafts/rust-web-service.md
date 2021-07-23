# Building a web service with Rust, Postgres and Kafka

After reading a whole _10 chapters_ of the [📕 Rust Book](https://doc.rust-lang.org/book/),
I decided that the best way to continue learning would be to try building something with it.
The opportunity came when my team and I needed a throwaway service to provide functionality
that would be eventually handled by a third party, in order to provide a manual way for a 
user to provide that data to the system now. The service would be small enough that if everything
goes wrong I can quickly rewrite it using .NET, and as it will definitely be replaced by 
new functionality in an existing system we can relax some of the more complicated-to-implement 
constraints around data/error handling.

This service would need several capabilities:

- provide http endpoints - [Actix](https://actix.rs/) seems to be a solid, mature option
- save data to a Postgres database - the common choice for this seems to be [Diesel](https://diesel.rs/), but
I have an irrational hatred of ORMs so instead using [tokio-postgres](https://github.com/sfackler/rust-postgres)
with [deadpool](https://crates.io/crates/deadpool-postgres) for connection pooling
- send messages over Kafka - and [rust-rdkafka](https://github.com/fede1024/rust-rdkafka) 
appears to be an excellent choice

This service will be responsible for storing data after receiving a http request 
and then raising an event that will be processed by another service. Later it will need to 
process and respond to follow up events about the data, but that is not covered in this article.

With an understanding of the requirements, and an idea of the technology setup we're ready to 
bring _Sample Service_ to life 👶 

## HTTP Endpoint With Actix

### Hello World 👋 

To start with, we can make a service that runs and responds with a static message on a single 
HTTP endpoint.

After creating the project with `cargo new` we need to add a depencency on Actix to our `cargo.toml` 
file:

```toml
[dependencies]
actix-web = "3"
```

Then we need to replace the code in `main.rs` with a function to handle our sample endpoint, and 
appropriate config to run the Actix `HttpServer`:

```rust
use actix_web::{web, App, HttpResponse, HttpServer};

fn hello_world() -> HttpResponse {
    HttpResponse::Ok().body("hi! 👋")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(move || App::new().route("hello", web::get().to(hello_world)))
        .bind("0.0.0.0:8000")?
        .run()
        .await
}
```

The `hello_world()` function returns a `200 OK`http response with a simple text message in the body.

The `main()` function runs a new http server on port 8000, and binds the `hello_world()` function 
to the path `/hello`.

We can quickly test this by running the server using `cargo run` and making a request locally:

```http
GET http://localhost:8000/hello
```

```http
hi! 👋
// GET http://localhost:8000/hello
// HTTP/1.1 200 OK
// content-length: 8
```

### POSTing Data 📬 

Just returning static data isn't very useful - we need to be able to receive data from a client
and then do something with it. To do that, we'll make a POST endpoint that can deserialize json 
into a type that we'll define. 

The data we receive should be identifiable, so it will have an `id` property that we will use a `Uuid`
for, as well as some other data that we can store in `String`s:

```rust
pub struct SampleData {
    id: Uuid,
    name: String,
    special_code: String
}
```

In order to use `Uuid` we need to add a dependency on the [uuid crate](https://crates.io/crates/uuid).
We also need to make this type (de)serializable and [Serde](https://serde.rs/) seems to be the 
standard choice for that in Rust. Both should be added to the `cargo.toml` file as dependencies 
alongside `actix-web`:

```toml
[dependencies]
actix-web = "3"
uuid = { version = "0.8", features = ["serde"] }
serde = "1.0.126"
```

Cargo dependencies have a neat option to have different features toggled on or off when they're 
included in the `cargo.toml` file - here we make use of it to toggle on the serde bindings that 
are provided by the uuid crate 😍 

With the dependencies in place, we can automatically derive the traits needed for serialization
of our type:

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SampleData {
    id: Uuid,
    name: String,
    special_code: String
}
```

The extra `serde` attribute handles translating property names between `snake_case` in our rust
code and `camelCase` which is more common in json.

With the data type in place, we can add an endpoint to the application that will receive this data as 
json. Artix uses [Extractors](https://actix.rs/docs/extractors/) to handle deserialization automatically
using the serde traits that we have already derived for our type. If deserialization fails, it will 
return a `400 Bad Request` otherwise it will pass the deserialized value to our handler function. 
That makes it very straightforward for us to add an endpoint that receives the data and returns the 
id for it as a small check that everything is working as we expect.

The handler function is defined:

```rust
fn receive_data(sample: web::Json<SampleData>) -> HttpResponse {
    HttpResponse::Ok().body(sample.id.to_hyphenated().to_string())
}
```

And then added to the `HttpServer` in the `main` function:

```rust
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(move || {
        App::new()
            .route("hello", web::get().to(hello_world))
            .route("data", web::post().to(receive_data))
    })
    .bind("0.0.0.0:8000")?
    .run()
    .await
}
```

This is also quick to test using `cargo run` and making a request against the service:

```http
POST http://localhost:8000/data
Content-Type: application/json

{
  "id": "82115a42-3b60-4adf-b7c8-6a5afe73bc58",
  "name": "test",
  "specialCode": "1234"
}
```

```http
82115a42-3b60-4adf-b7c8-6a5afe73bc58
// POST http://localhost:8000/data
// HTTP/1.1 200 OK
// content-length: 36
```

### Logging 🪵

When the service is deployed and being used, it would be useful to have it log some information
so we could monitor if everything was running as expected. We can start very simply by 
printing messages when the service starts and stops so we get some output to tell us that it's 
running:

```rust
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("🧑‍🔬 Sample Service Starting");

    let result = HttpServer::new(move || {
        App::new()
            .route("hello", web::get().to(hello_world))
            .route("data", web::post().to(receive_data))
    })
    .bind("0.0.0.0:8000")?
    .run()
    .await;

    println!("🧑‍🔬 Sample Service Stopping");

    result
}
```

Note how we now assign the result of runing the `HttpServer` to a value so that we can print a
message just before the service terminates.

This gives us an idea that the service is running, but it doesn't provide any information about what 
happens while the service is running - fortunately we can provide Actix with a `Logger` and 
it will log information about each request. Actix uses [Middleware](https://actix.rs/docs/middleware/)
to implement logging, and we can pass it any log implementation that is compatible with the 
[log crate](https://docs.rs/log/0.4.14/log/) facade. There are 
[sensible](https://docs.rs/env_logger/0.9.0/env_logger/) 
[logging](https://docs.rs/pretty_env_logger/0.4.0/pretty_env_logger/)
[options](https://docs.rs/log4rs/1.0.0/log4rs/) to choose from, but for this service we'll use the 
much more interesting [emoji-logger](https://crates.io/crates/emoji-logger) 😀 

To set up the logger we first add a dependency in `cargo.toml`:

```toml
[dependencies]
...
emoji-logger = "0.1.0"
```

Reference the crate with `extern crate emoji_logger;` at the top of `main.rs` and then initialise it 
in the `main()` function using `emoji_logger::init();`. This will create the logger, but we still need
to configure Actix to use it by passing one or more `Logger`s with the format we want. We can also 
provide an environment variable to configure the level of log messages that are output - for now we can 
set that in code, but later we should read that from the environment so that it's easy to configure 
between different environments (for example, we might want to output a lot of data when running locally, 
but find that would be too spammy when the service is running in production).

With our logger initialised and configured with Actix we now have the following code:

```rust
use actix_web::{App, HttpResponse, HttpServer, middleware::Logger, web};
// other dependencies

extern crate emoji_logger;

// types and handlers

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("🧑‍🔬 Sample Service Starting");

    std::env::set_var("RUST_LOG", "actix_web=info");
    emoji_logger::init();

    let result = HttpServer::new(move || {
        App::new()
            .wrap(Logger::default())
            .route("hello", web::get().to(hello_world))
            .route("data", web::post().to(receive_data))
    })
    .bind("0.0.0.0:8000")?
    .run()
    .await;

    println!("🧑‍🔬 Sample Service Stopping");

    result
}
```

We can double check this by running the service with `cargo run`, making some sample HTTP requests
against it, and then checking the console output - it should show something like this:

```
🧑‍🔬 Sample Service Starting
 😋 I  27.44  actix_web:logger > 127.0.0.1:61222 "GET /hello HTTP/1.1" 200 8 "-" "-" 0.000167
 😋 I  95.19  actix_web:logger > 127.0.0.1:61416 "POST /data HTTP/1.1" 200 36 "-" "-" 0.000248
 😋 I  125.96  actix_web:logger > 127.0.0.1:61506 "POST /data HTTP/1.1" 400 0 "-" "-" 0.000240
^C🧑‍🔬 Sample Service Stopping
```

Actix supports a bunch of different [format options](https://actix.rs/docs/middleware/#format) to 
configure what should be included in log messages if we wanted to change the output, but the 
default is good enough for now.

## Saving Data In Postgres

### Config 🗒

Now that our service can receive data, we need to do something with it - and we can start by saving
it to a database.

There are many ways to setup a database server that won't be covered here, but as a prerequisite 
for our code we will need a table to work against:

```sql
CREATE TABLE public.sample (
  id uuid NOT NULL,
  sample_data jsonb NOT NULL,
  CONSTRAINT sample_pk PRIMARY KEY (id)
);
```

For providing connection details to our service it's best if we can use an external configuration source
so that we can change the values without having to recompile and deploy. We can use environment
variables for this purpose, and use the [rust-dotenv](https://crates.io/crates/dotenv) crate to keep 
configuration values for local development in a config file.

To do this we add `dotenv` to our dependencies:

```toml
[dependencies]
...
dotenv = "0.15.0"
```

Add a `.env` file in the same directory as `cargo.toml` containing the configuration values we want to use:

```
PG.USER=dbuser
PG.PASSWORD=secret-database-password
PG.HOST=127.0.0.1
PG.PORT=5432
PG.DBNAME=sampledb
PG.POOL.MAX_SIZE=16

RUST_LOG=actix_web=info
```

Then reference `dotenv` in our code and load the values in our `main()` function:

```rust
use dotenv::dotenv;

// other code

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // this loads our .env file and includes the values in std::env
    dotenv().ok();
    
    // other code
}
```

With the values defined and loaded from the environment, they can be moved into a `Config` object
that will let us create a connection pool for the database that can be passed to Actix to provide 
to handlers when needed. There are several dependencies needed to communicate with the database:

```toml
[dependencies]
...
deadpool-postgres = "0.5.0"
tokio-postgres = { version="0.5.1", features=["with-uuid-0_8", "with-serde_json-1"] }
postgres-openssl = "0.3.0"
openssl = "0.10.35"
config = "0.11.0"
```

⚠ For `deadpool-postgres` it's important (currently) to use this version because  `actix-web` and 
`deadpool-postgres` reference different, incompatible versions of `tokio` in their latest versions.

This also enables support in `tokio-postgres`for using `Uuid` values, and using `serde` to handle 
serialization of json values by toggling those features on.

A `DbConfig` type can give us a straightforward wrapper around the `deadpool_postgres::Config` type
and allow us to encapsulate loading configuration values into it:

```rust
use ::config::ConfigError;

#[derive(Deserialize)]
pub struct DbConfig {
    pub pg: deadpool_postgres::Config,
}
impl DbConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let mut cfg = ::config::Config::new();
        cfg.merge(::config::Environment::new())?;
        cfg.try_into()
    }
}
```

We can then use this in a factory function to create a connection pool that we can pass to Actix so that
it in turn can pass it on to handlers that need to access the database.

```rust
use deadpool_postgres::Pool;
use openssl::ssl::{SslConnector, SslMethod};
use postgres_openssl::*;

async fn make_db_pool() -> Pool {
    let config = DbConfig::from_env().unwrap();
    let builder = SslConnector::builder(SslMethod::tls()).unwrap();
    let connector = MakeTlsConnector::new(builder.build());
    config.pg.create_pool(connector).unwrap()
}
```


This function uses `unwrap()` instead of returning a `Result` with any potential error because it will be 
run only once, on startup, and any errors would be configuration errors that should be corrected before
running the service. Additionally, `deadpool` won't try to establish a connection until one is needed,
which should rule out transient database connectivity errors preventing the service from starting - so 
panicking is (imo) appropriate 😅

Using the `data()`method when setting up the `HttpServer` will allow Actix to give handlers access to the
connection pool:

```rust
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("🧑‍🔬 Sample Service Starting");

    dotenv().ok();
    emoji_logger::init();

    let pool = make_db_pool().await;

    let result = HttpServer::new(move || {
        App::new()
            .wrap(Logger::default())
            .data(pool.clone())
            .route("hello", web::get().to(hello_world))
            .route("data", web::post().to(receive_data))
    })
    .bind("0.0.0.0:8000")?
    .run()
    .await;

    println!("🧑‍🔬 Sample Service Stopping");

    result
}
```

## Saving Data 💾 

Now that we have a way to access the database, we should save any data that we receive to it.

We use a `deadpool_postgres::Client` to communicate with the database through the connection pool and
will need some `SampleData` to insert into it:

```rust
use deadpool_postgres::{Client, Pool};
use tokio_postgres::types::Json;

async fn insert_sample(client: &Client, sample: &SampleData) -> Result<u64, tokio_postgres::Error> {
    client
        .execute(
            "INSERT INTO public.sample (id, sample_data) VALUES ($1, $2)",
            &[&sample.id, &Json(&sample)],
        )
        .await
}
```

The `Data<>` extractor from Actix allows us to get access to application state, which in this case is 
the connection pool we created earlier. The `Pool` in turn allows us to get a `Client` to communicate 
with the database:

```rust
async fn receive_data(sample: web::Json<SampleData>, db_pool: web::Data<Pool>) -> HttpResponse {
    let client: Client = db_pool.get().await.unwrap();

    insert_sample(&client, &sample).await.unwrap();

    HttpResponse::Ok().body(sample.id.to_hyphenated().to_string())
}
```

We don't need to adjust the server configuration to accomodate any of the changes we've made to the 
handler here, and this can be tested by running the service with `cargo run` and then querying the 
database after making a successful POST request.

```sql
sampledb=# select * from sample;
                  id                  |                                      sample_data                                      
--------------------------------------+---------------------------------------------------------------------------------------
 9a6743c2-7c49-4c4d-a136-14714ba50247 | {"id": "9a6743c2-7c49-4c4d-a136-14714ba50247", "name": "name", "specialCode": "code"}
(1 row)
```

## Handling Errors ❌ 

The `receive_data` function works properly for the happy path of events, but if there are any problems
connecting to the database or inserting a new record it will panic. Actix will catch the panic for us
and return a `500 Internal Server Error` to the client, but that doesn't provide a very good experience
and panicking for every error like that is very bad practice.

To improve things, we can create a custom error type that implements the `ResponseError` trait and have 
the handler return a `Result` then Actix will be able to return a better response to the client.

The error type will also need to implement some other traits, but by taking a dependency on the
[derive_more](https://crates.io/crates/derive_more) crate these can be generated.

```toml
[dependencies]
...
derive_more = "0.99.16"
```

With that in place we can define an error type that fits the few errors we want to handle:

```rust
use actix_web::{middleware::Logger, web, App, HttpResponse, HttpServer, ResponseError};
use derive_more::{Display, From};

#[derive(Display, From, Debug)]
enum SampleError {
    DatabaseError,
    InvalidData
}
impl std::error::Error for SampleError {}

impl ResponseError for SampleError {
    fn error_response(&self) -> HttpResponse {
        match *self {
            SampleError::DatabaseError => HttpResponse::InternalServerError().finish(),
            SampleError::InvalidData => HttpResponse::BadRequest().finish(),
        }
    }
}
```

The error types are kept as cases in an `enum` and we match over them to provide a different 
`HttpResponse` that Actix will return to clients if our handler returns a failing result. 
The responses implemented here are very simple, but if needed we could also add more 
data to the response to help clients understand the problem.

In the handler, the calls to `unwrap()`can now be replaced with `map_err` calls to convert 
the error receved from database code into the new `ResponseError` type then we can use the
`?` operator to return the failure immediately:

```rust
async fn receive_data(
    sample: web::Json<SampleData>,
    db_pool: web::Data<Pool>,
) -> Result<HttpResponse, SampleError> {
    let client: Client = db_pool
        .get()
        .await
        .map_err(|_| SampleError::DatabaseError)?;

    insert_sample(&client, &sample)
        .await
        .map_err(|_| SampleError::InvalidData)?;

    Ok(HttpResponse::Ok().body(sample.id.to_hyphenated().to_string()))
}
```

Changing the return type to `Result` also requires wrapping the return value in `Ok()` so that the
types line up properly.

The main difference from the outside is that now submitting two requests with the same id will
return a `400 Bad Request` instead of panicking and returning `500 Internal Server Error`.

## Sending Messages Over Kafka

### Config 🗒 

The final requirement for the service is that it can raise events about new sample data over 
Kafka, which will be done using a `FutureProducer` from [rust-rdkafka](https://github.com/fede1024/rust-rdkafka).

When connecting to a local Kafka instance we typically wouldn't need any client authentication,
however when connecting to a production Kafka cluster we probably need to use more secure methods
in this case we need to use SASL to connect. As long as we include the necessary dependencies for 
both approaches, we can vary the 
[configuration options](https://github.com/edenhill/librdkafka/blob/master/CONFIGURATION.md)
that we pass in to ensure that we use the proper method in each environment.

In `cargo.toml` we add these dependencies:

```toml
[dependencies]
rdkafka = { version = "0.26.0", features = [ "ssl", "sasl"] }
sasl2-sys = { version = "*", features = [ "vendored" ] }
```

The `rdkafka` dependency should have `ssl` and `sasl` features toggled on, and the `sasl2-sys` 
dependency is included using `*` as the version so that it will just take whichever version
`rdkafka` uses, and toggling on the `vendored` feature ensuring that `libsasl2` will be 
bundled with the service rather than relying on the underlying system to already have this 
library.

We want to load our configuration from the environment, but the properties included in the 
configuration might also vary between environments. For example, locally we might only need
to set `bootstrap.servers` but in production we would rely on setting `security.protocol` 
and the properties pertaining to our chosen authentication method. A simple way of ensuring 
that we load all the configuration values for each environment without having to model or
handle missing values is to add a prefix to their names in the environment and iterate 
over them adding them directly to the `rdkafka::ClientConfig`. With that approach we can
define a function to create a producer:

```rust
use rdkafka::{producer::FutureProducer, ClientConfig};

fn make_producer() -> FutureProducer {
    let mut config = ClientConfig::new();
    std::env::vars()
        .filter(|(key, _)| key.starts_with("KAFKA_"))
        .for_each(|(key, value)| {
            let name = key.trim_start_matches("KAFKA_").to_lowercase();

            config.set(name, value);
        });

    config
        .set("message.timeout.ms", "5000")
        .create::<FutureProducer>()
        .expect("Producer creation error")
}
```

This function can also set any config values that we don't want to vary across environments
(this sets `message.timeout.ms` directly), and will panic if it can't create a producer 
because we expect that to be caused by a configuration error that we would want to correct
before running the service.

With the appropriate config value in our `.env` file:

```
KAFKA_BOOTSTRAP.SERVERS=localhost:29092
```

The `main` function can be modified to create a `FutureProducer` on startup that can be used
by our handlers:

```rust
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("🧑‍🔬 Sample Service Starting");

    dotenv().ok();
    emoji_logger::init();

    let pool = make_db_pool().await;
    let producer = make_producer();

    let result = HttpServer::new(move || {
        App::new()
            .wrap(Logger::default())
            .data(pool.clone())
            .data(producer.clone())
            .route("hello", web::get().to(hello_world))
            .route("data", web::post().to(receive_data))
    })
    .bind("0.0.0.0:8000")?
    .run()
    .await;

    println!("🧑‍🔬 Sample Service Stopping");

    result
}
```

This uses the same `data` method as for the database connection pool to include the `FutureProducer` 
as part of application state in Actix.

## Sending Messages 📨 

With the connection in place, we need to actually produce messages to send over Kafka. We'll send messages
as json, and will wrap them in a standard envelope to make handling a variety of messages easier for a consumer.

`serde_json` has a handy [`json!` macro](https://docs.serde.rs/serde_json/macro.json.html) that can take a 
json literal and return a `Value`, and we can use this to wrap the data to be sent in our envelope format.
The envelope format contains a message type that will always be the same as we only send one type of message, 
and a `messageId` field that we will set using a new `Uuid`
To do this requires adding a dependency on `serde_json` and adding an extra feature to the `uuid` dependency:

```toml
[dependencies]
uuid = { version = "0.8", features = ["serde", "v4"] }
serde_json = "1.0"
```

With those in place we can define a function that can take a `FutureProducer` and some `SampleData` then 
wrap the data in the envelope format and send it to Kafka with the producer:

```rust
use serde_json::json;
use std::time::Duration;

async fn send_sample_message(
    producer: &FutureProducer,
    sample: &SampleData,
) -> () {
    let msg = json!({
        "messageId" : Uuid::new_v4(),
        "type" : "sample_received",
        "data" : sample
    });

    producer
        .send(
            FutureRecord::to("sample-received")
                .key("messageId")
                .payload(&msg.to_string()),
            Duration::from_secs(0),
        )
        .await
        .map(|_| ())
        .unwrap()
}
```

This creates a `FutureRecord` to pass the message to the `sample-received` topic on Kafka, and provides a 
`Duration` to the `producer.send` method to specify how long it should wait if the queue is full when trying 
to send the message - setting this to `0`  will mean that it will fail immediately if the message cannot 
be enqueued.

In the case that this message does fail to send, the `unwrap()` call will cause it to panic even though 
the Kafka library returns a result. We can add a new error case to the `SampleError` type so that we can 
handle the error properly and return a message to the client to explain what failed:

```rust
#[derive(Display, From, Debug)]
enum SampleError {
    DatabaseError,
    InvalidData,
    KafkaError
}
impl std::error::Error for SampleError {}

impl ResponseError for SampleError {
    fn error_response(&self) -> HttpResponse {
        match *self {
            SampleError::DatabaseError => HttpResponse::InternalServerError().body("Error saving to database"),
            SampleError::InvalidData => HttpResponse::BadRequest().finish(),
            SampleError::KafkaError => HttpResponse::InternalServerError().body("Error sending to kafka"),
        }
    }
}
```

ℹ It's worth noting that the [`KafkaError`](https://docs.rs/rdkafka/0.26.0/rdkafka/error/enum.KafkaError.html) 
returned from `rdkafka` provides a lot more detail about what went wrong when sending to Kafka, which 
could be useful to refine this message in the future - but we won't go into that here.

With the error type updated, the send function can be updated to return a `Result`:

```rust
async fn send_sample_message(
    producer: &FutureProducer,
    sample: &SampleData,
) -> Result<(), SampleError> {
    let msg = json!({
        "messageId" : Uuid::new_v4(),
        "type" : "sample_received",
        "data" : sample
    });

    producer
        .send(
            FutureRecord::to("sample-received")
                .key("messageId")
                .payload(&msg.to_string()),
            Duration::from_secs(0),
        )
        .await
        .map_err(|_| SampleError::KafkaError)
        .map(|_| ())
}
```

Then the `receive_data` handler can be updated to take a `FutureProducer` from application state,
and send a sample message to Kafka after saving it to the database:

```rust
async fn receive_data(
    sample: web::Json<SampleData>,
    db_pool: web::Data<Pool>,
    producer: web::Data<FutureProducer>
) -> Result<HttpResponse, SampleError> {
    let client: Client = db_pool
        .get()
        .await
        .map_err(|_| SampleError::DatabaseError)?;

    insert_sample(&client, &sample)
        .await
        .map_err(|_| SampleError::InvalidData)?;
    send_sample_message(&producer, &sample).await?;

    Ok(HttpResponse::Ok().body(sample.id.to_hyphenated().to_string()))
}
```

With all the pieces in place we can test manually by running with `cargo run`, making a http request to the 
endpoint and then consuming the Kafka topic directly (I'll use [Kaf](https://github.com/birdayz/kaf) for this):

```http
POST http://localhost:8000/data
Content-Type: application/json

{
  "id" : "67a678eb-70b7-4c86-bf1d-94dd5d8bf39d",
  "name" : "Dave the Sample",
  "specialCode" : "code"
}
```

```bash
$ kaf consume sample-received
Key:         messageId
Partition:   0
Offset:      0
Timestamp:   2021-07-23 09:43:48.44 +0200 CEST
{
  "data": {
    "id": "67a678eb-70b7-4c86-bf1d-94dd5d8bf39d",
    "name": "Dave the Sample",
    "specialCode": "code"
  },
  "messageId": "b92d6fe0-4354-4f5c-99f1-ca2547f2483a",
  "type": "sample_received"
}
```

This shows that the message went to our topic in the format we expected 🎉 

# Wrapping Up

With all this in place we should now have a service that can receive data over http and then send it to 
both a postgres database and a Kafka topic. There are a bunch of potential improvements that could be 
made - for example, we might end up in a bad state where we write to the database successfully but 
never send the value over Kafka which might cause issues in downstream systems - but this should be 
needs-meeting for most cases. 🙂 

Hopefully this is a useful guide for putting all these pieces together, as I said at the start I'm not
a rust expert and this is mostly a walkthrough of what I ended up doing after finding various samples 
and snippets for the individual pieces. 

If you have any thoughts/suggestions/feelings/reckonings/anecdotes or otherwise, feel free to reach 
out on [twitter](https://twitter.com/ChamookTweets) 🙌 

