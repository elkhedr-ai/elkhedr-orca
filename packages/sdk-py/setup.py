from setuptools import setup, find_packages

setup(
    name="orca-client",
    version="1.0.0",
    description="Official Python client for Elkhedr Orca multi-agent orchestration API",
    author="Elkhedr",
    license="MIT",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "httpx>=0.25.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-asyncio>=0.21.0",
        ]
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
)
