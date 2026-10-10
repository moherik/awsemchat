use super::Engine;
use jni::{
    objects::{JObject, JString},
    sys::{jlong, jstring},
    JNIEnv,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicI64, Ordering},
        Mutex, OnceLock,
    },
};

static ENGINES: OnceLock<Mutex<HashMap<i64, Engine>>> = OnceLock::new();
static NEXT: AtomicI64 = AtomicI64::new(1);
fn engines() -> &'static Mutex<HashMap<i64, Engine>> {
    ENGINES.get_or_init(|| {
        // Release panics abort; suppress payload formatting before that abort.
        std::panic::set_hook(Box::new(|_| {}));
        Mutex::new(HashMap::new())
    })
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_awsemchatcrypto_AwsemchatCryptoModule_createNative(
    _env: JNIEnv,
    _this: JObject,
) -> jlong {
    let Ok(mut engines) = engines().lock() else {
        return 0;
    };
    if engines.len() >= 8 {
        return 0;
    }
    let Ok(id) = NEXT.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
    else {
        return 0;
    };
    engines.insert(id, Engine::default());
    id
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_awsemchatcrypto_AwsemchatCryptoModule_executeNative(
    mut env: JNIEnv,
    _this: JObject,
    context: jlong,
    input: JString,
) -> jstring {
    // No Rust error, panic payload or caller data is forwarded into Java exceptions/logs.
    let response = match env.get_string(&input) {
        Ok(text) => match engines().lock() {
            Ok(mut engines) => match engines.get_mut(&context) {
                Some(engine) => engine.execute(&text.to_string_lossy()),
                None => "{\"ok\":false,\"code\":\"CLOSED\"}".into(),
            },
            Err(_) => "{\"ok\":false,\"code\":\"UNAVAILABLE\"}".into(),
        },
        Err(_) => "{\"ok\":false,\"code\":\"INVALID_INPUT\"}".into(),
    };
    match env.new_string(response) {
        Ok(value) => value.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_awsemchatcrypto_AwsemchatCryptoModule_destroyNative(
    _env: JNIEnv,
    _this: JObject,
    context: jlong,
) {
    if let Ok(mut engines) = engines().lock() {
        engines.remove(&context);
    }
}

#[no_mangle]
pub extern "system" fn Java_expo_modules_awsemchatcrypto_AwsemchatCryptoModule_prepareDurableNative(
    mut env: JNIEnv,
    _this: JObject,
    snapshot: JString,
    input: JString,
) -> jstring {
    let result = (|| {
        let saved = if snapshot.is_null() {
            None
        } else {
            Some(
                env.get_string(&snapshot)
                    .map_err(|_| "STATE_INVALID")?
                    .to_string_lossy()
                    .into_owned(),
            )
        };
        let input = env
            .get_string(&input)
            .map_err(|_| "INVALID_INPUT")?
            .to_string_lossy()
            .into_owned();
        super::durable::prepare(saved.as_deref(), &input)
    })();
    let response = match result {
        Ok((state, output)) => serde_json::json!({"ok":true,"state":state,"output":output}),
        Err(code) => serde_json::json!({"ok":false,"code":code}),
    };
    env.new_string(response.to_string())
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
