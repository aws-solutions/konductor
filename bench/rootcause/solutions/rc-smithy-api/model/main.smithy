$version: "2"

namespace example.library

@title("Library Lending API")
@httpBearerAuth
@auth([httpBearerAuth])
service LibraryLending {
    version: "2025-01-01"
    resources: [Book, Loan]
    errors: [ValidationError, ThrottlingError]
}

resource Book {
    identifiers: { bookId: BookId }
    create: CreateBook
    read: GetBook
    update: UpdateBook
    delete: DeleteBook
    list: ListBooks
}

resource Loan {
    identifiers: { loanId: LoanId }
    create: CreateLoan
    read: GetLoan
    list: ListLoans
    operations: [ReturnLoan]
}

@http(method: "POST", uri: "/books", code: 201)
operation CreateBook {
    input: CreateBookInput
    output: BookOutput
}

@readonly
@http(method: "GET", uri: "/books/{bookId}")
operation GetBook {
    input: GetBookInput
    output: BookOutput
    errors: [BookNotFound]
}

@http(method: "PATCH", uri: "/books/{bookId}")
operation UpdateBook {
    input: UpdateBookInput
    output: BookOutput
    errors: [BookNotFound]
}

@idempotent
@http(method: "DELETE", uri: "/books/{bookId}", code: 204)
operation DeleteBook {
    input: DeleteBookInput
    errors: [BookNotFound, BookHasActiveLoans]
}

@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "books")
@http(method: "GET", uri: "/books")
operation ListBooks {
    input: ListBooksInput
    output: ListBooksOutput
}

@http(method: "POST", uri: "/loans", code: 201)
operation CreateLoan {
    input: CreateLoanInput
    output: LoanOutput
    errors: [BookNotFound, NoCopiesAvailable]
}

@readonly
@http(method: "GET", uri: "/loans/{loanId}")
operation GetLoan {
    input: GetLoanInput
    output: LoanOutput
    errors: [LoanNotFound]
}

@idempotent
@http(method: "POST", uri: "/loans/{loanId}/return")
operation ReturnLoan {
    input: ReturnLoanInput
    output: LoanOutput
    errors: [LoanNotFound]
}

@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "loans")
@http(method: "GET", uri: "/loans")
operation ListLoans {
    input: ListLoansInput
    output: ListLoansOutput
}

@input
structure CreateBookInput {
    @required
    title: BookTitle

    @required
    isbn: Isbn

    @required
    authors: AuthorList

    @required
    copies: CopyCount
}

@input
structure GetBookInput {
    @required
    @httpLabel
    bookId: BookId
}

@input
structure UpdateBookInput {
    @required
    @httpLabel
    bookId: BookId

    title: BookTitle

    copies: CopyCount
}

@input
structure DeleteBookInput {
    @required
    @httpLabel
    bookId: BookId
}

@input
structure ListBooksInput {
    @httpQuery("author")
    author: AuthorName

    @httpQuery("nextToken")
    nextToken: String

    @httpQuery("maxResults")
    @range(min: 1, max: 100)
    maxResults: Integer
}

@output
structure BookOutput {
    @required
    bookId: BookId

    @required
    title: BookTitle

    @required
    isbn: Isbn

    @required
    authors: AuthorList

    @required
    copies: CopyCount

    @required
    copiesAvailable: Integer
}

@output
structure ListBooksOutput {
    @required
    books: BookList

    nextToken: String
}

@input
structure CreateLoanInput {
    @idempotencyToken
    clientToken: String

    @required
    bookId: BookId

    @required
    memberId: MemberId
}

@input
structure GetLoanInput {
    @required
    @httpLabel
    loanId: LoanId
}

@input
structure ReturnLoanInput {
    @required
    @httpLabel
    loanId: LoanId
}

@input
structure ListLoansInput {
    @required
    @httpQuery("memberId")
    memberId: MemberId

    @httpQuery("nextToken")
    nextToken: String

    @httpQuery("maxResults")
    @range(min: 1, max: 100)
    maxResults: Integer
}

@output
structure LoanOutput {
    @required
    loanId: LoanId

    @required
    bookId: BookId

    @required
    memberId: MemberId

    @required
    @timestampFormat("date-time")
    borrowedAt: Timestamp

    @required
    @timestampFormat("date-time")
    dueAt: Timestamp

    @timestampFormat("date-time")
    returnedAt: Timestamp
}

@output
structure ListLoansOutput {
    @required
    loans: LoanList

    nextToken: String
}

list BookList {
    member: BookOutput
}

list LoanList {
    member: LoanOutput
}

@length(min: 1, max: 300)
string BookTitle

@pattern("^[0-9]{13}$")
string Isbn

@range(min: 1, max: 100)
integer CopyCount

@length(min: 1, max: 200)
string AuthorName

@length(min: 1, max: 10)
list AuthorList {
    member: AuthorName
}

@pattern("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
string BookId

@pattern("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
string LoanId

@pattern("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
string MemberId

@error("client")
@httpError(400)
structure ValidationError {
    @required
    message: String
}

@error("client")
@httpError(404)
structure BookNotFound {
    @required
    message: String
}

@error("client")
@httpError(404)
structure LoanNotFound {
    @required
    message: String
}

@error("client")
@httpError(409)
structure NoCopiesAvailable {
    @required
    message: String
}

@error("client")
@httpError(409)
structure BookHasActiveLoans {
    @required
    message: String
}

@error("client")
@retryable(throttling: true)
@httpError(429)
structure ThrottlingError {
    @required
    message: String
}
