import pytest


@pytest.fixture
def sample_repo(tmp_path):
    """Minimal Python repo — used by existing indexer/server tests."""
    (tmp_path / "calculator.py").write_text("""\
class Calculator:
    def add(self, a, b):
        return a + b

    def divide(self, a, b):
        if b == 0:
            raise ValueError("cannot divide by zero")
        return a / b

def helper():
    calc = Calculator()
    return calc.add(1, 2)
""")
    (tmp_path / "main.py").write_text("""\
from calculator import Calculator

def run():
    calc = Calculator()
    result = calc.divide(10, 2)
    return result
""")
    return tmp_path


@pytest.fixture
def rich_py_repo(tmp_path):
    """Python repo with decorators, cross-file references, and realistic patterns."""
    (tmp_path / "models.py").write_text("""\
from dataclasses import dataclass

@dataclass
class User:
    name: str
    email: str

def get_user_by_email(email: str):
    return None
""")
    (tmp_path / "services.py").write_text("""\
from models import User, get_user_by_email

class UserService:
    def create(self, name: str, email: str):
        return User(name=name, email=email)

    @staticmethod
    def validate(email: str) -> bool:
        return '@' in email

def process_request(name: str, email: str):
    svc = UserService()
    if svc.validate(email):
        return svc.create(name, email)
    return None
""")
    return tmp_path


@pytest.fixture
def multi_lang_repo(tmp_path):
    """Repo with Python, JS, TS, Go, and Rust files to exercise multi-language indexing."""
    (tmp_path / "calc.py").write_text("""\
def add(a, b):
    return a + b

class Calc:
    def multiply(self, a, b):
        return a * b
""")
    (tmp_path / "utils.js").write_text("""\
const double = x => x * 2;

export function greet(name) {
    return 'Hello ' + name;
}

export const triple = (x) => x * 3;
""")
    (tmp_path / "types.ts").write_text("""\
export interface Shape {
    area(): number;
}

export class Circle implements Shape {
    constructor(public radius: number) {}
    area(): number {
        return Math.PI * this.radius ** 2;
    }
}

export const makeCircle = (r: number): Circle => new Circle(r);
""")
    (tmp_path / "server.go").write_text("""\
package main

type Server struct {
	port int
}

type Handler interface {
	Handle(req string) string
}

func NewServer(port int) *Server {
	return &Server{port: port}
}
""")
    (tmp_path / "config.rs").write_text("""\
pub struct Config {
    pub host: String,
    pub port: u16,
}

impl Config {
    pub fn new(host: String, port: u16) -> Self {
        Config { host, port }
    }
}

pub fn default_config() -> Config {
    Config::new("localhost".to_string(), 8080)
}
""")
    (tmp_path / "math.c").write_text("""\
#include <stdio.h>

struct Calculator {
    int value;
};

int add(int a, int b) {
    return a + b;
}
""")
    (tmp_path / "calculator.cpp").write_text("""\
#include <iostream>

class Calculator {
public:
    int add(int a, int b) {
        return a + b;
    }
};

int helper() {
    Calculator c;
    return c.add(1, 2);
}
""")
    (tmp_path / "calc.rb").write_text("""\
class Calculator
  def add(a, b)
    a + b
  end
end

def helper
  Calculator.new.add(1, 2)
end
""")
    return tmp_path
