from __future__ import annotations

import ast
import sys
import unittest
from dataclasses import dataclass
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.security.service_role_policy import ALLOWED_SERVICE_ROLE_EXCEPTIONS


APP_DIR = BACKEND_DIR / "app"
SCRIPTS_DIR = BACKEND_DIR / "scripts"
SERVICE_ROLE_KEY_NAMES = {"SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"}


@dataclass
class Violation:
    module_name: str
    target: str
    operation: str
    lineno: int
    message: str

    def render(self) -> str:
        return (
            f"{self.module_name}:{self.lineno} | {self.target} | "
            f"{self.operation} | {self.message}"
        )


@dataclass
class ScopeState:
    admin_names: set[str]
    get_admin_names: set[str]
    raw_vars: set[str]
    wrapper_vars: set[str]


def _module_name_from_path(path: Path) -> str:
    rel = path.relative_to(BACKEND_DIR).with_suffix("")
    return ".".join(rel.parts)


def _annotation_mentions(annotation: ast.AST | None, name: str) -> bool:
    if annotation is None:
        return False

    for node in ast.walk(annotation):
        if isinstance(node, ast.Name) and node.id == name:
            return True
        if isinstance(node, ast.Attribute) and node.attr == name:
            return True
    return False


class WrapperSignatureCollector(ast.NodeVisitor):
    def __init__(self, module_name: str):
        self.module_name = module_name
        self.context_stack: list[str] = []
        self.signatures: dict[str, set[str]] = {}

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.context_stack.append(node.name)
        self.generic_visit(node)
        self.context_stack.pop()

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.context_stack.append(node.name)
        wrapper_params = set()
        for arg in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs):
            if _annotation_mentions(arg.annotation, "TenantSupabaseClient"):
                wrapper_params.add(arg.arg)
        if wrapper_params:
            self.signatures[node.name] = wrapper_params
        self.generic_visit(node)
        self.context_stack.pop()


class ServiceRolePolicyAnalyzer(ast.NodeVisitor):
    def __init__(
        self,
        *,
        module_name: str,
        source: str,
        wrapper_signatures: dict[str, set[str]],
        allowlist: dict[str, dict],
    ) -> None:
        self.module_name = module_name
        self.source = source
        self.lines = source.splitlines()
        self.wrapper_signatures = wrapper_signatures
        self.allowlist = allowlist
        self.violations: list[Violation] = []
        self.context_stack: list[str] = []
        self.scope_stack: list[ScopeState] = [ScopeState(set(), set(), set(), set())]

    def current_target(self) -> str:
        if not self.context_stack:
            return f"{self.module_name}:<module>"
        return f"{self.module_name}:{'.'.join(self.context_stack)}"

    def current_scope(self) -> ScopeState:
        return self.scope_stack[-1]

    def push_scope(self) -> None:
        scope = self.current_scope()
        self.scope_stack.append(
            ScopeState(
                set(scope.admin_names),
                set(scope.get_admin_names),
                set(scope.raw_vars),
                set(scope.wrapper_vars),
            )
        )

    def pop_scope(self) -> None:
        self.scope_stack.pop()

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.context_stack.append(node.name)
        self.push_scope()
        self.generic_visit(node)
        self.pop_scope()
        self.context_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.context_stack.append(node.name)
        self.push_scope()
        for arg in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs):
            if _annotation_mentions(arg.annotation, "TenantSupabaseClient"):
                self.current_scope().wrapper_vars.add(arg.arg)
        self.generic_visit(node)
        self.pop_scope()
        self.context_stack.pop()

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module == "app.config":
            for alias in node.names:
                imported_name = alias.asname or alias.name
                if alias.name == "admin_supabase":
                    self.current_scope().admin_names.add(imported_name)
                    self._record_policy_use(
                        operation="raw_admin_import",
                        lineno=node.lineno,
                        message="raw service-role client import is deny-by-default",
                    )
        elif node.module == "app.dependencies":
            for alias in node.names:
                imported_name = alias.asname or alias.name
                if alias.name == "get_admin_supabase":
                    self.current_scope().get_admin_names.add(imported_name)
                    self._record_policy_use(
                        operation="raw_admin_dependency",
                        lineno=node.lineno,
                        message="raw privileged dependency import is deny-by-default",
                    )
        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        if self._expr_is_raw_service_role(node.value):
            for target in node.targets:
                self._record_raw_assignment_target(target)
        if self._expr_is_tenant_wrapper(node.value):
            for target in node.targets:
                self._record_wrapper_assignment_target(target)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None and self._expr_is_raw_service_role(node.value):
            self._record_raw_assignment_target(node.target)
        if node.value is not None and self._expr_is_tenant_wrapper(node.value):
            self._record_wrapper_assignment_target(node.target)
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr == "raw" and self._expr_is_tenant_wrapper(node.value):
            self._record_policy_use(
                operation="hazardous_raw_access",
                lineno=node.lineno,
                message="TenantSupabaseClient.raw is a hazardous escape hatch",
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if self._is_depends_get_admin(node):
            self._record_policy_use(
                operation="raw_admin_dependency",
                lineno=node.lineno,
                message="Depends(get_admin_supabase) is forbidden outside the allowlist",
            )

        if self._is_service_role_factory(node):
            self._record_policy_use(
                operation="service_role_factory",
                lineno=node.lineno,
                message="direct service-role client construction is deny-by-default",
            )

        if self._is_direct_admin_table_call(node):
            self._record_policy_use(
                operation="direct_admin_table_access",
                lineno=node.lineno,
                message="direct PostgREST access through a raw service-role client is deny-by-default",
            )

        if self._is_illegal_raw_postgrest_call(node):
            self.violations.append(
                Violation(
                    module_name=self.module_name,
                    target=self.current_target(),
                    operation="hazardous_raw_access",
                    lineno=node.lineno,
                    message=".raw.table(...) and .raw.rpc(...) are always forbidden",
                )
            )

        if self._has_wrapper_bypass(node):
            self.violations.append(
                Violation(
                    module_name=self.module_name,
                    target=self.current_target(),
                    operation="raw_client_wrapper_bypass",
                    lineno=node.lineno,
                    message="raw service-role client passed into a TenantSupabaseClient-only helper",
                )
            )

        self.generic_visit(node)

    def _record_raw_assignment_target(self, target: ast.AST) -> None:
        if isinstance(target, ast.Name):
            self.current_scope().raw_vars.add(target.id)

    def _record_wrapper_assignment_target(self, target: ast.AST) -> None:
        if isinstance(target, ast.Name):
            self.current_scope().wrapper_vars.add(target.id)

    def _record_policy_use(self, *, operation: str, lineno: int, message: str) -> None:
        target = self.current_target()
        entry = self.allowlist.get(target)

        if entry is None or operation not in entry["allowed_operations"]:
            self.violations.append(
                Violation(
                    module_name=self.module_name,
                    target=target,
                    operation=operation,
                    lineno=lineno,
                    message=message,
                )
            )
            return

        if operation == "hazardous_raw_access" and entry["category"] != "non_postgrest_storage_access":
            self.violations.append(
                Violation(
                    module_name=self.module_name,
                    target=target,
                    operation=operation,
                    lineno=lineno,
                    message=".raw is only allowlistable for non-PostgREST storage access",
                )
            )
            return

        if not self._has_required_comment(lineno, entry["required_comment_prefixes"]):
            self.violations.append(
                Violation(
                    module_name=self.module_name,
                    target=target,
                    operation=operation,
                    lineno=lineno,
                    message="allowlisted service-role access is missing the required review comment",
                )
            )

    def _has_required_comment(self, lineno: int, prefixes: tuple[str, ...]) -> bool:
        start = max(0, lineno - 6)
        window = self.lines[start:lineno]
        return any(prefix in line for line in window for prefix in prefixes)

    def _has_wrapper_bypass(self, node: ast.Call) -> bool:
        callee_name = self._callable_name(node.func)
        if callee_name not in self.wrapper_signatures:
            return False

        wrapper_params = self.wrapper_signatures[callee_name]
        for keyword in node.keywords:
            if keyword.arg in wrapper_params and self._expr_is_raw_service_role(keyword.value):
                return True
        return False

    def _callable_name(self, node: ast.AST) -> str | None:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        return None

    def _is_depends_get_admin(self, node: ast.Call) -> bool:
        if self._callable_name(node.func) != "Depends" or not node.args:
            return False
        dependency = node.args[0]
        return isinstance(dependency, ast.Name) and dependency.id in self.current_scope().get_admin_names

    def _is_direct_admin_table_call(self, node: ast.Call) -> bool:
        if not isinstance(node.func, ast.Attribute) or node.func.attr != "table":
            return False
        return self._expr_is_raw_service_role(node.func.value)

    def _is_illegal_raw_postgrest_call(self, node: ast.Call) -> bool:
        if not isinstance(node.func, ast.Attribute) or node.func.attr not in {"table", "rpc"}:
            return False
        return (
            isinstance(node.func.value, ast.Attribute)
            and node.func.value.attr == "raw"
            and self._expr_is_tenant_wrapper(node.func.value.value)
        )

    def _is_service_role_factory(self, node: ast.Call) -> bool:
        func_name = self._callable_name(node.func)
        if func_name == "create_admin_supabase":
            return True
        if func_name != "create_client":
            return False

        for arg in node.args:
            if self._expr_mentions_service_role_key(arg):
                return True
        for keyword in node.keywords:
            if self._expr_mentions_service_role_key(keyword.value):
                return True
        return False

    def _expr_mentions_service_role_key(self, expr: ast.AST) -> bool:
        for node in ast.walk(expr):
            if isinstance(node, ast.Name) and node.id in SERVICE_ROLE_KEY_NAMES:
                return True
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                if node.value in SERVICE_ROLE_KEY_NAMES:
                    return True
        return False

    def _expr_is_raw_service_role(self, expr: ast.AST) -> bool:
        if isinstance(expr, ast.Await):
            return self._expr_is_raw_service_role(expr.value)
        if isinstance(expr, ast.Name):
            scope = self.current_scope()
            return expr.id in scope.admin_names or expr.id in scope.raw_vars
        if isinstance(expr, ast.Call):
            func_name = self._callable_name(expr.func)
            if func_name in self.current_scope().get_admin_names:
                return True
            if self._is_service_role_factory(expr):
                return True
        return False

    def _expr_is_tenant_wrapper(self, expr: ast.AST) -> bool:
        if isinstance(expr, ast.Await):
            return self._expr_is_tenant_wrapper(expr.value)
        if isinstance(expr, ast.Name):
            return expr.id in self.current_scope().wrapper_vars
        if isinstance(expr, ast.Call):
            func_name = self._callable_name(expr.func)
            return func_name in {"get_tenant_admin_supabase", "TenantSupabaseClient"}
        return False


def collect_wrapper_signatures(paths: list[Path]) -> dict[str, set[str]]:
    signatures: dict[str, set[str]] = {}
    for path in paths:
        source = path.read_text()
        tree = ast.parse(source, filename=str(path))
        collector = WrapperSignatureCollector(_module_name_from_path(path))
        collector.visit(tree)
        for function_name, wrapper_params in collector.signatures.items():
            signatures.setdefault(function_name, set()).update(wrapper_params)
    return signatures


def analyze_source(
    *,
    module_name: str,
    source: str,
    wrapper_signatures: dict[str, set[str]] | None = None,
    allowlist: dict[str, dict] | None = None,
) -> list[Violation]:
    tree = ast.parse(source, filename=module_name)
    analyzer = ServiceRolePolicyAnalyzer(
        module_name=module_name,
        source=source,
        wrapper_signatures=wrapper_signatures or {},
        allowlist=allowlist or ALLOWED_SERVICE_ROLE_EXCEPTIONS,
    )
    analyzer.visit(tree)
    return analyzer.violations


class ServiceRolePolicyTests(unittest.TestCase):
    def test_allowlist_entries_have_required_fields(self):
        self.assertTrue(ALLOWED_SERVICE_ROLE_EXCEPTIONS)
        for target, entry in ALLOWED_SERVICE_ROLE_EXCEPTIONS.items():
            self.assertIn(":", target)
            self.assertTrue(entry["reason"])
            self.assertTrue(entry["category"])
            self.assertTrue(entry["allowed_operations"])
            self.assertTrue(entry["required_comment_prefixes"])

    def test_snippet_flags_raw_admin_import_outside_allowlist(self):
        source = """
from app.config import admin_supabase

def leak():
    return admin_supabase.table("contracts")
"""
        violations = analyze_source(module_name="app.fake", source=source)
        self.assertTrue(any(item.operation == "raw_admin_import" for item in violations))
        self.assertTrue(any(item.operation == "direct_admin_table_access" for item in violations))

    def test_snippet_flags_depends_get_admin_supabase_outside_allowlist(self):
        source = """
from fastapi import Depends
from app.dependencies import get_admin_supabase

def route(dep=Depends(get_admin_supabase)):
    return dep
"""
        violations = analyze_source(module_name="app.fake", source=source)
        self.assertTrue(any(item.operation == "raw_admin_dependency" for item in violations))

    def test_snippet_flags_service_role_factory_outside_allowlist(self):
        source = """
from supabase import create_client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

def leak():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
"""
        violations = analyze_source(module_name="app.fake", source=source)
        self.assertTrue(any(item.operation == "service_role_factory" for item in violations))

    def test_snippet_allows_allowlisted_non_postgrest_raw_access(self):
        source = """
def upload_contract(storage_client: TenantSupabaseClient):
    # NON-POSTGREST: reviewed storage upload path outside PostgREST.
    return storage_client.raw
"""
        allowlist = {
            "app.routers.contracts:upload_contract": {
                "reason": "test",
                "category": "non_postgrest_storage_access",
                "allowed_operations": ("hazardous_raw_access",),
                "required_comment_prefixes": ("# NON-POSTGREST:",),
            }
        }
        violations = analyze_source(
            module_name="app.routers.contracts",
            source=source,
            allowlist=allowlist,
        )
        self.assertEqual(violations, [])

    def test_snippet_rejects_raw_table_even_when_allowlisted(self):
        source = """
def upload_contract(storage_client: TenantSupabaseClient):
    # NON-POSTGREST: reviewed storage upload path outside PostgREST.
    return storage_client.raw.table("contracts")
"""
        allowlist = {
            "app.routers.contracts:upload_contract": {
                "reason": "test",
                "category": "non_postgrest_storage_access",
                "allowed_operations": ("hazardous_raw_access",),
                "required_comment_prefixes": ("# NON-POSTGREST:",),
            }
        }
        violations = analyze_source(
            module_name="app.routers.contracts",
            source=source,
            allowlist=allowlist,
        )
        self.assertTrue(any(".raw.table" in item.message for item in violations))

    def test_snippet_flags_raw_client_passed_to_wrapper_only_helper(self):
        source = """
from app.config import admin_supabase

def helper(*, tenant_supabase_client: TenantSupabaseClient):
    return tenant_supabase_client

def leak():
    return helper(tenant_supabase_client=admin_supabase)
"""
        violations = analyze_source(
            module_name="app.fake",
            source=source,
            wrapper_signatures={"helper": {"tenant_supabase_client"}},
        )
        self.assertTrue(any(item.operation == "raw_client_wrapper_bypass" for item in violations))

    def test_repo_scan_has_no_service_role_policy_violations(self):
        paths = sorted(APP_DIR.rglob("*.py")) + sorted(SCRIPTS_DIR.rglob("*.py"))
        wrapper_signatures = collect_wrapper_signatures(paths)
        violations: list[Violation] = []

        for path in paths:
            source = path.read_text()
            module_name = _module_name_from_path(path)
            violations.extend(
                analyze_source(
                    module_name=module_name,
                    source=source,
                    wrapper_signatures=wrapper_signatures,
                )
            )

        rendered = "\n".join(item.render() for item in violations)
        self.assertEqual([], violations, rendered)


if __name__ == "__main__":
    unittest.main()
