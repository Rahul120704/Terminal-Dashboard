cmake_minimum_required(VERSION 3.20)
project(bti_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Compiler flags (MSVC) ─────────────────────────────────────────────────────
if(MSVC)
    add_compile_options(
        /O2        # maximize speed
        /GL        # whole program optimization
        /Gy        # function-level linking
        /W4        # warning level 4
        /WX-       # don't treat warnings as errors (pybind11 has some)
        /arch:AVX2 # enable AVX2 SIMD (all modern Intel/AMD CPUs)
        /EHsc      # C++ exceptions
        /MP        # multi-processor compilation
        /fp:fast   # fast floating point
    )
    add_link_options(/LTCG)  # link-time code generation
else()
    # GCC/Clang (for cross-platform builds)
    add_compile_options(
        -O3 -march=native -Wall -Wextra
        -ffast-math -funroll-loops
    )
endif()

# ── Python + pybind11 ─────────────────────────────────────────────────────────
# Find Python from the venv if PYTHON_EXECUTABLE is set
if(DEFINED ENV{PYTHON_EXECUTABLE})
    set(Python3_EXECUTABLE "$ENV{PYTHON_EXECUTABLE}")
endif()

find_package(Python3 REQUIRED COMPONENTS Interpreter Development)
message(STATUS "Python3: ${Python3_VERSION} at ${Python3_EXECUTABLE}")

# Try to find pybind11 via pip install
execute_process(
    COMMAND ${Python3_EXECUTABLE} -c "import pybind11; print(pybind11.get_cmake_dir())"
    OUTPUT_VARIABLE PYBIND11_CMAKE_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE _pybind11_result
)

if(_pybind11_result EQUAL 0)
    list(APPEND CMAKE_PREFIX_PATH "${PYBIND11_CMAKE_DIR}")
    find_package(pybind11 CONFIG REQUIRED)
    message(STATUS "pybind11: ${pybind11_VERSION} from ${PYBIND11_CMAKE_DIR}")
else()
    # Fallback: clone pybind11 as submodule
    message(WARNING "pybind11 not found via pip. Run: pip install pybind11")
    include(FetchContent)
    FetchContent_Declare(
        pybind11
        GIT_REPOSITORY https://github.com/pybind/pybind11.git
        GIT_TAG        v2.12.0
    )
    FetchContent_MakeAvailable(pybind11)
endif()

# ── bti_engine module ─────────────────────────────────────────────────────────
pybind11_add_module(bti_engine
    src/bindings.cpp
)

target_include_directories(bti_engine PRIVATE src)

# Optimization: strip debug info from release build
if(MSVC)
    target_compile_options(bti_engine PRIVATE /GS- /Oy)  # no stack check, omit frame pointer
    set_target_properties(bti_engine PROPERTIES
        MSVC_RUNTIME_LIBRARY "MultiThreaded"  # static CRT for portability
    )
endif()

# ── Install ───────────────────────────────────────────────────────────────────
# Installs .pyd/.so directly into the backend directory for import
install(
    TARGETS bti_engine
    LIBRARY DESTINATION ${CMAKE_SOURCE_DIR}/../backend
    RUNTIME DESTINATION ${CMAKE_SOURCE_DIR}/../backend
)

message(STATUS "")
message(STATUS "=== BTI Engine Build Config ===")
message(STATUS "  Compiler:   ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "  C++ Std:    C++${CMAKE_CXX_STANDARD}")
message(STATUS "  Python:     ${Python3_VERSION}")
message(STATUS "  Install to: ${CMAKE_SOURCE_DIR}/../backend")
message(STATUS "===============================")
