use super::*;
use crate::ipc::tests::Fixture;
use crate::model::asset::Mode;

fn ready() -> Fixture {
    let fixture = Fixture::new();
    let mut asset = fixture.seed_ready_server();
    if let crate::model::asset::Asset::Vps(server) = &mut asset {
        server.production = true;
    }
    fixture.backend.database().unwrap().upsert_asset(&asset).unwrap();
    fixture.backend.set_mode(asset.id(), Mode::Standard).unwrap();
    fixture
}

fn message(fixture: &Fixture, op: &str, id: Option<&str>) -> Value {
    let service = fixture.backend.execution().unwrap();
    json!({
        "version":protocol::VERSION,"installationId":service.installation_id(),
        "epoch":service.owner.epoch(),"capability":service.capability,
        "ownerToken":"1".repeat(64),"op":op,"requestId":id,"input":{"envId":"windows"},
    })
}

fn submit(fixture: &Fixture, command: &str) -> Value {
    let asset = fixture
        .backend
        .list_assets()
        .unwrap()
        .into_iter()
        .find(|asset| asset.as_server().is_some())
        .unwrap();
    let mut req = message(fixture, "submit", None);
    req["input"] = json!({"envId":"windows","assetId":asset.id(),"kind":"exec","args":[command],"timeoutSec":90,"cwd":fixture.paths.user_home.to_string_lossy()});
    fixture.backend.execution_rpc(&req).unwrap()
}

fn approve(fixture: &Fixture, reply: &Value) -> ExecutionRequest {
    fixture
        .backend
        .respond_execution(RespondExecutionRequest {
            request_id: reply["requestId"].as_str().unwrap().into(),
            expected_revision: reply["revision"].as_u64().unwrap(),
            decision: ExecutionResponse::AllowOnce,
        })
        .unwrap()
}

#[test]
fn approval_is_not_execution_and_claim_is_consumed_once() {
    let fixture = ready();
    let waiting = submit(&fixture, "docker compose down -v");
    assert_eq!(waiting["state"], "waiting");
    let id = waiting["requestId"].as_str().unwrap();
    assert_eq!(approve(&fixture, &waiting).state, ExecutionState::Approved);
    let first = fixture
        .backend
        .execution_rpc(&message(&fixture, "claim", Some(id)))
        .unwrap();
    assert_eq!(first["state"], "dispatching");
    assert!(first["input"].is_object());
    assert_eq!(
        first["routeDigest"],
        runtime::digest(&serde_json::to_vec(&first["route"]).unwrap())
    );
    let second = fixture
        .backend
        .execution_rpc(&message(&fixture, "claim", Some(id)))
        .unwrap();
    assert_eq!(second["state"], "dispatching");
    assert!(second.get("input").is_none());
    assert!(second.get("route").is_none());
    assert!(
        fixture
            .backend
            .respond_execution(RespondExecutionRequest {
                request_id: id.into(),
                expected_revision: waiting["revision"].as_u64().unwrap(),
                decision: ExecutionResponse::AllowOnce
            })
            .is_err()
    );
    assert_eq!(
        fixture
            .backend
            .execution_rpc(&message(&fixture, "started", Some(id)))
            .unwrap()["state"],
        "running"
    );
    let mut finish = message(&fixture, "finish", Some(id));
    finish["outcome"] = "succeeded".into();
    finish["exitCode"] = 0.into();
    finish["durationMs"] = 42.into();
    assert_eq!(fixture.backend.execution_rpc(&finish).unwrap()["state"], "succeeded");
    assert_eq!(fixture.backend.list_execution_requests().unwrap()[0].exit_code, Some(0));
}

#[test]
fn no_socket_operation_or_foreign_ticket_can_approve_or_read_the_input() {
    let fixture = ready();
    let waiting = submit(&fixture, "docker compose down -v");
    let id = waiting["requestId"].as_str().unwrap();
    let mut foreign = message(&fixture, "claim", Some(id));
    foreign["ownerToken"] = "2".repeat(64).into();
    assert_eq!(
        fixture.backend.execution_rpc(&foreign).unwrap()["reasonId"],
        "execution-not-found"
    );
    let approve_rpc = message(&fixture, "approve", Some(id));
    assert_eq!(
        fixture.backend.execution_rpc(&approve_rpc).unwrap()["reasonId"],
        "execution-protocol-invalid"
    );
    assert_eq!(
        fixture.backend.list_execution_requests().unwrap()[0].state,
        ExecutionState::Waiting
    );
    let gui_json = serde_json::to_string(&fixture.backend.list_execution_requests().unwrap()).unwrap();
    for private in ["ownerToken", "capability", "inputDigest", "configPath"] {
        assert!(!gui_json.contains(private));
    }
}

#[test]
fn wrong_wait_environment_does_not_consume_the_original_permit() {
    let fixture = ready();
    let waiting = submit(&fixture, "docker compose down -v");
    let approved = approve(&fixture, &waiting);
    let mut wrong = message(&fixture, "claim", Some(&approved.request_id));
    wrong["input"]["envId"] = "wsl:Ubuntu-24.04".into();
    assert_eq!(
        fixture.backend.execution_rpc(&wrong).unwrap()["reasonId"],
        "execution-ticket-invalid"
    );
    assert_eq!(
        fixture.backend.list_execution_requests().unwrap()[0].state,
        ExecutionState::Approved
    );
    let correct = fixture
        .backend
        .execution_rpc(&message(&fixture, "claim", Some(&approved.request_id)))
        .unwrap();
    assert!(correct["input"].is_object());
}

#[test]
fn supported_queries_are_checked_but_do_not_create_approval_cards() {
    let fixture = ready();
    let allowed = submit(&fixture, "uptime; free -m");
    assert_eq!(allowed["state"], "approved");
    let view = fixture.backend.list_execution_requests().unwrap().pop().unwrap();
    assert!(view.checked);
    assert!(!view.approval_required);
}

#[test]
fn credentials_are_never_approvable_and_denial_releases_raw_payload() {
    let fixture = ready();
    let denied = submit(&fixture, "cat /etc/shadow");
    assert_eq!(denied["state"], "denied");
    let service = fixture.backend.execution().unwrap();
    let pending = &service.requests[denied["requestId"].as_str().unwrap()];
    assert!(pending.input.is_null());
    assert!(pending.route.is_null());
    assert!(!pending.view.approval_required);
}

#[test]
fn narrowing_cancels_approved_and_dispatching_requests_and_late_answers() {
    for dispatch in [false, true] {
        let fixture = ready();
        let waiting = submit(&fixture, "docker compose down -v");
        let approved = approve(&fixture, &waiting);
        if dispatch {
            fixture
                .backend
                .execution_rpc(&message(&fixture, "claim", Some(&approved.request_id)))
                .unwrap();
        }
        fixture.backend.set_mode(&approved.asset_id, Mode::ReadOnly).unwrap();
        assert_eq!(
            fixture.backend.list_execution_requests().unwrap()[0].state,
            ExecutionState::Cancelled
        );
        let claimed = fixture
            .backend
            .execution_rpc(&message(&fixture, "claim", Some(&approved.request_id)))
            .unwrap();
        assert_eq!(claimed["state"], "cancelled");
        assert!(claimed.get("input").is_none());
    }
}

#[test]
fn expiry_is_from_creation_and_starting_or_unknown_is_not_a_bypass() {
    let fixture = ready();
    let waiting = submit(&fixture, "docker compose down -v");
    let id = waiting["requestId"].as_str().unwrap();
    {
        let mut service = fixture.backend.execution().unwrap();
        service.requests.get_mut(id).unwrap().view.expires_at =
            crate::time::format_rfc3339(crate::time::now_secs() - 1);
    }
    assert_eq!(
        fixture.backend.list_execution_requests().unwrap()[0].state,
        ExecutionState::Expired
    );
    for state in [RuntimeState::Starting, RuntimeState::Unknown] {
        fixture.backend.execution().unwrap().state = state;
        assert_eq!(submit(&fixture, "uptime")["reasonId"], "runtime-not-ready");
    }
}

#[test]
fn exit_cancels_unstarted_but_started_results_can_finish_without_a_new_grant() {
    let fixture = ready();
    let waiting = submit(&fixture, "docker compose down -v");
    let query = submit(&fixture, "uptime");
    let id = query["requestId"].as_str().unwrap();
    fixture
        .backend
        .execution_rpc(&message(&fixture, "claim", Some(id)))
        .unwrap();
    fixture
        .backend
        .execution_rpc(&message(&fixture, "started", Some(id)))
        .unwrap();
    fixture.backend.stop_execution();
    let service = fixture.backend.execution().unwrap();
    assert_eq!(
        service.requests[waiting["requestId"].as_str().unwrap()].view.state,
        ExecutionState::Cancelled
    );
    assert_eq!(service.requests[id].view.state, ExecutionState::Running);
    drop(service);
    let mut finish = message(&fixture, "finish", Some(id));
    finish["outcome"] = "succeeded".into();
    finish["exitCode"] = 0.into();
    assert_eq!(fixture.backend.execution_rpc(&finish).unwrap()["state"], "succeeded");
    assert_eq!(submit(&fixture, "uptime")["reasonId"], "runtime-not-ready");
}

#[test]
fn late_reliable_result_can_close_unknown_but_never_start_a_second_child() {
    let fixture = ready();
    let query = submit(&fixture, "uptime");
    let id = query["requestId"].as_str().unwrap();
    fixture
        .backend
        .execution_rpc(&message(&fixture, "claim", Some(id)))
        .unwrap();
    fixture
        .backend
        .execution_rpc(&message(&fixture, "started", Some(id)))
        .unwrap();
    {
        let mut service = fixture.backend.execution().unwrap();
        service.change(
            id,
            ExecutionState::Unknown,
            Some("execution-result-unknown"),
            crate::time::now_secs(),
        );
        assert!(service.requests[id].input.is_null());
    }
    assert!(
        fixture
            .backend
            .execution_rpc(&message(&fixture, "claim", Some(id)))
            .unwrap()
            .get("input")
            .is_none()
    );
    let mut finish = message(&fixture, "finish", Some(id));
    finish["outcome"] = "succeeded".into();
    finish["exitCode"] = 0.into();
    assert_eq!(fixture.backend.execution_rpc(&finish).unwrap()["state"], "succeeded");
}

#[test]
fn large_route_claim_uses_digest_without_exceeding_the_frame_or_truncating_scope() {
    let fixture = ready();
    let query = submit(&fixture, "uptime");
    let id = query["requestId"].as_str().unwrap();
    let mut service = fixture.backend.execution().unwrap();
    service.requests.get_mut(id).unwrap().route["fixtureScope"] = "x".repeat(protocol::MAX_FRAME).into();
    let result = reply(&service, id, true);
    assert!(result.get("route").is_none());
    assert!(result["routeDigest"].is_string());
    assert!(serde_json::to_vec(&result).unwrap().len() < protocol::MAX_FRAME);
    assert!(service.requests[id].route["fixtureScope"].as_str().unwrap().len() == protocol::MAX_FRAME);
}
